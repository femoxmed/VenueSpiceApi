import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { EventEntity } from '../events/entities/event.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import {
	FinancialLedgerEntryEntity,
	FinancialLedgerEntryStatus,
	FinancialLedgerEntryType,
} from './entities/financial-ledger-entry.entity';

@Injectable()
export class FinancialLedgerService {
	private readonly logger = new Logger(FinancialLedgerService.name);

	constructor(
		@InjectRepository(FinancialLedgerEntryEntity)
		private readonly ledgerRepository: Repository<FinancialLedgerEntryEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		private readonly platformSettingsService: PlatformSettingsService,
		private readonly auditService: AuditService,
	) {}

	async syncOrganizationOrders(organizationId: string) {
		const orders = await this.ticketOrdersRepository.find({
			where: { organization: { id: organizationId } },
			order: { paidAt: 'DESC', createdAt: 'DESC' },
		});

		for (const order of orders) {
			await this.syncOrder(order);
		}
		await this.releaseAvailableEntries(organizationId);
	}

	async syncOrder(order: TicketOrderEntity) {
		if (!['paid', 'refunded'].includes(order.status)) return;

		const availability = await this.calculateAvailability(order);
		const availableAt = availability.availableAt;
		const status: FinancialLedgerEntryStatus = availableAt.getTime() <= Date.now()
			? 'available'
			: 'pending';
		const payoutMode = this.feeSnapshotString(order, 'stripePayoutMode') || this.inferPayoutMode(order);
		const payoutEligible = payoutMode !== 'legacy_destination_charge';
		const organizerNetStatus: FinancialLedgerEntryStatus = payoutEligible ? status : 'paid_out';
		const organizerNetAvailableAt = payoutEligible ? availableAt : order.paidAt || order.createdAt || new Date();

		const entries: Array<{
			type: FinancialLedgerEntryType;
			amount: number;
			status: FinancialLedgerEntryStatus;
			availableAt?: Date;
			metadata?: Record<string, unknown>;
		}> = [
			{ type: 'gross_sale', amount: Number(order.subtotal || 0), status, metadata: { payoutMode } },
			{ type: 'tax', amount: Number(order.tax || 0), status, metadata: { payoutMode } },
			{ type: 'platform_fee', amount: -Number(order.platformFee || 0), status, metadata: { payoutMode } },
			{ type: 'processing_fee', amount: -Number(order.processingFee || 0), status, metadata: { payoutMode } },
			{
				type: 'influencer_commission',
				amount: -this.feeSnapshotNumber(order, 'influencerCommission', 0),
				status,
				metadata: {
					payoutMode,
					referralCode: order.referralCode?.code ?? null,
					agentId: order.referralCode?.agent?.id ?? null,
				},
			},
			{
				type: 'organizer_net',
				amount: Number(order.organizerNet || 0),
				status: organizerNetStatus,
				availableAt: organizerNetAvailableAt,
				metadata: {
					payoutMode,
					payoutEligible,
					paidOutAutomaticallyByStripe: !payoutEligible,
					payoutPolicySnapshot: availability.policySnapshot,
				},
			},
		];

		for (const entry of entries) {
			if (Math.abs(entry.amount) <= 0) continue;
			await this.upsertOrderEntry(order, entry.type, entry.amount, entry.status, entry.availableAt ?? availableAt, entry.metadata);
		}

		if (order.status === 'refunded') {
			await this.upsertOrderEntry(
				order,
				'refund',
				-Number(order.organizerNet || 0),
				'reversed',
				new Date(),
				{ reversedOrderId: order.id },
			);
			await this.ledgerRepository
				.createQueryBuilder()
				.update(FinancialLedgerEntryEntity)
				.set({ status: 'reversed' })
				.where('"orderId" = :orderId', { orderId: order.id })
				.andWhere('type = :type', { type: 'organizer_net' })
				.execute();
		}
	}

	async delayPendingOrganizerNetForEventDateChange(
		event: EventEntity,
		previousEndDate: Date,
		nextEndDate: Date,
		actor?: { id?: string; email?: string; role?: string },
	) {
		const previousAnchor = this.toValidDate(previousEndDate);
		const nextAnchor = this.toValidDate(nextEndDate);
		if (!previousAnchor || !nextAnchor || nextAnchor.getTime() <= previousAnchor.getTime()) {
			return { affected: 0 };
		}

		const holdDays = await this.getHoldDays();
		const previousAvailableAt = this.addHoldDays(previousAnchor, holdDays);
		const nextAvailableAt = this.addHoldDays(nextAnchor, holdDays);
		if (nextAvailableAt.getTime() <= previousAvailableAt.getTime()) {
			return { affected: 0 };
		}

		const result = await this.ledgerRepository
			.createQueryBuilder()
			.update(FinancialLedgerEntryEntity)
			.set({
				status: 'pending',
				availableAt: nextAvailableAt,
				metadata: () => `COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
					'payoutDelayedByEventDateChange', true,
					'previousEventEndAt', '${previousAnchor.toISOString()}',
					'nextEventEndAt', '${nextAnchor.toISOString()}',
					'previousAvailableAt', '${previousAvailableAt.toISOString()}',
					'nextAvailableAt', '${nextAvailableAt.toISOString()}'
				)`,
			})
			.where('"eventId" = :eventId', { eventId: event.id })
			.andWhere('type = :type', { type: 'organizer_net' })
			.andWhere('status = :status', { status: 'pending' })
			.andWhere('(available_at IS NULL OR available_at < :nextAvailableAt)', { nextAvailableAt })
			.execute();

		if (result.affected) {
			await this.auditService.log(
				'financial_ledger.payout_maturity_delayed',
				actor,
				'event',
				event.id,
				{
					affected: result.affected,
					previousEventEndAt: previousAnchor.toISOString(),
					nextEventEndAt: nextAnchor.toISOString(),
					previousAvailableAt: previousAvailableAt.toISOString(),
					nextAvailableAt: nextAvailableAt.toISOString(),
				},
				{ organizationId: event.organization?.id, eventTitle: event.title },
			);
		}

		return result;
	}

	async getOrganizationEntries(organizationId: string) {
		await this.syncOrganizationOrders(organizationId);
		return this.ledgerRepository.find({
			where: { organization: { id: organizationId } },
			order: { createdAt: 'DESC' },
		});
	}

	async getBalance(organizationId: string) {
		const entries = await this.getOrganizationEntries(organizationId);
		const organizerEntries = entries.filter((entry) => entry.type === 'organizer_net');
		const payoutEntries = entries.filter((entry) => entry.type === 'payout');
		const pending = this.sum(
			organizerEntries.filter((entry) => entry.status === 'pending'),
		);
		const available = this.sum(
			organizerEntries.filter((entry) => entry.status === 'available'),
		);
		const legacyPaidOut = this.sum(
			organizerEntries.filter((entry) => {
				const metadata = entry.metadata ?? {};
				return entry.status === 'paid_out' && metadata.paidOutAutomaticallyByStripe === true;
			}),
		);
		const recordedPayouts = Math.abs(this.sum(
			payoutEntries.filter((entry) => entry.status === 'paid_out'),
		));
		const paidOut = legacyPaidOut + recordedPayouts;
		const reversed = Math.abs(this.sum(
			entries.filter((entry) => entry.status === 'reversed' || entry.type === 'refund'),
		));

		return {
			currency: entries[0]?.currency || 'USD',
			pending: this.roundMoney(pending),
			available: this.roundMoney(available),
			paidOut: this.roundMoney(paidOut),
			reversed: this.roundMoney(reversed),
			totalEarned: this.roundMoney(pending + available + paidOut),
			entries,
		};
	}

	async getWithdrawableEntries(organizationId: string) {
		await this.syncOrganizationOrders(organizationId);
		return this.ledgerRepository.find({
			where: {
				organization: { id: organizationId },
				type: 'organizer_net',
				status: 'available',
			},
			order: { availableAt: 'ASC', createdAt: 'ASC' },
		});
	}

	async prepareWithdrawableEntries(organizationId: string, requestedAmount: number, preferredEntryIds?: string[]) {
		const amount = this.roundMoney(requestedAmount);
		if (amount <= 0) return [];
		const entries = await this.getWithdrawableEntries(organizationId);
		const preferred = new Set(preferredEntryIds ?? []);
		const ordered = preferred.size
			? [
					...entries.filter((entry) => preferred.has(entry.id)),
					...entries.filter((entry) => !preferred.has(entry.id)),
				]
			: entries;
		const available = this.roundMoney(ordered.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
		if (available < amount) return [];

		const selected: FinancialLedgerEntryEntity[] = [];
		let remaining = amount;
		for (const entry of ordered) {
			if (remaining <= 0) break;
			const entryAmount = this.roundMoney(Number(entry.amount || 0));
			if (entryAmount <= 0) continue;
			if (entryAmount <= remaining + 0.0001) {
				selected.push(entry);
				remaining = this.roundMoney(remaining - entryAmount);
				continue;
			}

			const splitAmount = remaining;
			entry.amount = this.roundMoney(entryAmount - splitAmount);
			entry.metadata = {
				...(entry.metadata ?? {}),
				splitForWithdrawalAmount: splitAmount,
			};
			await this.ledgerRepository.save(entry);
			const splitEntry = await this.ledgerRepository.save(
				this.ledgerRepository.create({
					idempotencyKey: `ledger-split:${entry.id}:${Date.now()}`,
					organization: entry.organization,
					event: entry.event,
					order: entry.order,
					type: entry.type,
					status: entry.status,
					amount: splitAmount,
					currency: entry.currency,
					availableAt: entry.availableAt,
					metadata: {
						...(entry.metadata ?? {}),
						splitFromEntryId: entry.id,
						splitReason: 'withdrawal_request',
					},
				}),
			);
			selected.push(splitEntry);
			remaining = 0;
		}

		return this.roundMoney(remaining) <= 0 ? selected : [];
	}

	async recordPayoutSuccess(
		organizationId: string,
		entries: FinancialLedgerEntryEntity[],
		amount: number,
		currency: string,
		metadata: Record<string, unknown>,
		actor?: { id?: string; email?: string; role?: string },
	) {
		if (!entries.length || amount <= 0) return null;
		const now = new Date();
		const ids = entries.map((entry) => entry.id);
		await this.ledgerRepository
			.createQueryBuilder()
			.update(FinancialLedgerEntryEntity)
			.set({
				status: 'paid_out',
				paidOutAt: now,
				metadata: () => "COALESCE(metadata, '{}'::jsonb) || '{\"paidOutByWithdrawal\": true}'::jsonb",
			})
			.whereInIds(ids)
			.execute();
		const payoutEntry = await this.ledgerRepository.save(
			this.ledgerRepository.create({
				idempotencyKey: `organizer-payout:${organizationId}:${String(metadata.stripeTransferId || metadata.mockTransferId || Date.now())}`,
				organization: entries[0].organization,
				type: 'payout',
				status: 'paid_out',
				amount: -this.roundMoney(amount),
				currency,
				paidOutAt: now,
				availableAt: now,
				metadata: {
					...metadata,
					sourceEntryIds: ids,
				},
			}),
		);
		await this.auditService.log(
			'organizer_payout.paid_out',
			actor,
			'organization',
			organizationId,
			{ amount: this.roundMoney(amount), currency, sourceEntryIds: ids },
			metadata,
		);
		return payoutEntry;
	}

	async recordPayoutFailure(
		organizationId: string,
		entries: FinancialLedgerEntryEntity[],
		amount: number,
		currency: string,
		errorMessage: string,
		actor?: { id?: string; email?: string; role?: string },
		metadata?: Record<string, unknown>,
	) {
		const now = new Date();
		const failed = await this.ledgerRepository.save(
			this.ledgerRepository.create({
				idempotencyKey: `organizer-payout-failed:${organizationId}:${Date.now()}`,
				organization: entries[0]?.organization,
				type: 'payout',
				status: 'failed',
				amount: -this.roundMoney(amount),
				currency,
				availableAt: now,
				metadata: {
					...(metadata ?? {}),
					errorMessage,
					sourceEntryIds: entries.map((entry) => entry.id),
				},
			}),
		);
		await this.auditService.log(
			'organizer_payout.failed',
			actor,
			'organization',
			organizationId,
			{ amount: this.roundMoney(amount), currency, errorMessage },
			metadata,
		);
		return failed;
	}

	@Cron('0 * * * *')
	async releaseMaturedEntriesJob() {
		const result = await this.releaseAvailableEntries();
		if (result.affected) {
			this.logger.log(`Released ${result.affected} matured organizer ledger entries`);
			await this.auditService.log(
				'financial_ledger.entries_matured',
				{ role: 'system' },
				'financial_ledger',
				'maturity-job',
				{ affected: result.affected },
			);
		}
	}

	private async upsertOrderEntry(
		order: TicketOrderEntity,
		type: FinancialLedgerEntryType,
		amount: number,
		status: FinancialLedgerEntryStatus,
		availableAt: Date,
		metadata?: Record<string, unknown>,
	) {
		const idempotencyKey = `ticket-order:${order.id}:${type}`;
		const existing = await this.ledgerRepository.findOne({ where: { idempotencyKey } });
		const payload = {
			organization: order.organization,
			event: order.event,
			order,
			type,
			amount: this.roundMoney(amount),
			status,
			availableAt,
			currency: order.currency || 'USD',
			metadata: {
				...(existing?.metadata ?? {}),
				...(metadata ?? {}),
				orderStatus: order.status,
				feePayer: order.feePayer,
			},
		};

		if (existing) {
			if (type === 'organizer_net') {
				const adjustedPayload = this.applyOrganizerNetMaturityGuard(existing, payload);
				Object.assign(existing, adjustedPayload);
				return this.ledgerRepository.save(existing);
			}
			Object.assign(existing, payload);
			return this.ledgerRepository.save(existing);
		}

		return this.ledgerRepository.save(
			this.ledgerRepository.create({
				idempotencyKey,
				...payload,
			}),
		);
	}

	private async releaseAvailableEntries(organizationId?: string) {
		return this.ledgerRepository.update(
			{
				...(organizationId ? { organization: { id: organizationId } } : {}),
				status: 'pending',
				availableAt: LessThanOrEqual(new Date()),
			},
			{ status: 'available' },
		);
	}

	private async calculateAvailability(order: TicketOrderEntity) {
		const privileged = this.getActiveOrganizationPayoutPolicy(order);
		if (privileged) {
			const anchor = privileged.policy === 'after_payment'
				? this.toValidDate(order.paidAt) || this.toValidDate(order.createdAt) || new Date()
				: this.toValidDate(order.event?.endsAt) || this.toValidDate(order.event?.startsAt) || this.toValidDate(order.paidAt) || this.toValidDate(order.createdAt) || new Date();
			const availableAt = this.addHoldDays(anchor, privileged.delayDays);
			return {
				availableAt,
				policySnapshot: {
					source: 'organization_privilege',
					policy: privileged.policy,
					delayDays: privileged.delayDays,
					startsAt: privileged.startsAt.toISOString(),
					endsAt: privileged.endsAt.toISOString(),
					calculatedFrom: privileged.policy === 'after_payment' ? 'payment' : 'event_end',
					availableAt: availableAt.toISOString(),
				},
			};
		}

		const holdDays = await this.getHoldDays();
		const availableAt = this.calculateDefaultAvailableAt(order, holdDays);
		return {
			availableAt,
			policySnapshot: {
				source: 'platform_default',
				policy: 'after_event',
				delayDays: holdDays,
				calculatedFrom: 'event_end',
				availableAt: availableAt.toISOString(),
			},
		};
	}

	private calculateDefaultAvailableAt(order: TicketOrderEntity, holdDays: number) {
		if (holdDays <= 0) return new Date(order.paidAt || order.createdAt || new Date());
		const base = order.event?.endsAt || order.event?.startsAt || order.paidAt || order.createdAt || new Date();
		const date = this.toValidDate(base);
		if (!date) return new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
		return this.addHoldDays(date, holdDays);
	}

	private async getHoldDays() {
		const raw = await this.platformSettingsService.getOrganizerPayoutHoldDays();
		return Number.isFinite(raw) && raw >= 0 ? raw : 3;
	}

	private feeSnapshotNumber(order: TicketOrderEntity, key: string, fallback: number) {
		const value = order.feeSnapshot?.[key];
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : fallback;
	}

	private feeSnapshotString(order: TicketOrderEntity, key: string) {
		const value = order.feeSnapshot?.[key];
		return typeof value === 'string' ? value : '';
	}

	private inferPayoutMode(order: TicketOrderEntity) {
		if (order.stripePaymentIntentId || order.stripeCheckoutSessionId?.startsWith('cs_')) {
			return 'legacy_destination_charge';
		}
		return 'platform_hold';
	}

	private sum(entries: FinancialLedgerEntryEntity[]) {
		return entries.reduce((total, entry) => total + Number(entry.amount || 0), 0);
	}

	private roundMoney(value: number) {
		return Math.round((Number(value) || 0) * 100) / 100;
	}

	private applyOrganizerNetMaturityGuard(
		existing: FinancialLedgerEntryEntity,
		payload: Partial<FinancialLedgerEntryEntity>,
	) {
		if (existing.status === 'available' || existing.status === 'paid_out' || existing.status === 'reversed') {
			return {
				...payload,
				status: existing.status,
				availableAt: existing.availableAt,
				paidOutAt: existing.paidOutAt,
			};
		}

		const existingAvailableAt = this.toValidDate(existing.availableAt);
		const guardedAvailableAt = existingAvailableAt || payload.availableAt;
		const guardedStatus: FinancialLedgerEntryStatus = guardedAvailableAt && new Date(guardedAvailableAt).getTime() <= Date.now()
			? 'available'
			: 'pending';

		return {
			...payload,
			status: guardedStatus,
			availableAt: guardedAvailableAt,
		};
	}

	private addHoldDays(date: Date, holdDays: number) {
		const availableAt = new Date(date);
		availableAt.setDate(availableAt.getDate() + holdDays);
		return availableAt;
	}

	private getActiveOrganizationPayoutPolicy(order: TicketOrderEntity) {
		const organization = order.organization;
		const policy = organization?.payoutPolicy || 'platform_default';
		if (policy === 'platform_default') return null;
		const startsAt = this.toValidDate(organization.payoutPolicyStartsAt);
		const endsAt = this.toValidDate(organization.payoutPolicyEndsAt);
		const paidAt = this.toValidDate(order.paidAt) || this.toValidDate(order.createdAt) || new Date();
		if (!startsAt || !endsAt || startsAt >= endsAt) return null;
		if (paidAt < startsAt || paidAt > endsAt) return null;
		const delayDays = Number(organization.payoutDelayDays ?? 0);
		return {
			policy,
			delayDays: Number.isFinite(delayDays) && delayDays >= 0 ? delayDays : 0,
			startsAt,
			endsAt,
		};
	}

	private toValidDate(value?: Date | string | null) {
		if (!value) return null;
		const date = value instanceof Date ? value : new Date(value);
		return Number.isFinite(date.getTime()) ? date : null;
	}
}
