import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { EventEntity } from '../events/entities/event.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { WithdrawalRequestEntity } from '../organizer-sales/entities/withdrawal-request.entity';
import { RefundRequestEntity } from '../refunds/entities/refund-request.entity';
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
		@InjectRepository(OrganizationEntity)
		private readonly organizationRepository: Repository<OrganizationEntity>,
		@InjectRepository(WithdrawalRequestEntity)
		private readonly withdrawalRequestsRepository: Repository<WithdrawalRequestEntity>,
		@InjectRepository(RefundRequestEntity)
		private readonly refundsRepository: Repository<RefundRequestEntity>,
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

	async getBalance(organizationId: string, options: { synchronize?: boolean } = {}) {
		if (options.synchronize !== false) await this.syncOrganizationOrders(organizationId);
		await this.releaseAvailableEntries(organizationId);
		const totals = await this.ledgerRepository.createQueryBuilder('entry')
			.select("COALESCE(SUM(CASE WHEN entry.type = 'organizer_net' AND entry.status = 'pending' THEN entry.amount ELSE 0 END), 0)", 'pending')
			.addSelect("COALESCE(SUM(CASE WHEN entry.type = 'organizer_net' AND entry.status = 'available' THEN entry.amount ELSE 0 END), 0)", 'available')
			.addSelect("COALESCE(SUM(CASE WHEN entry.type = 'organizer_net' AND entry.status = 'paid_out' AND (entry.metadata->>'paidOutAutomaticallyByStripe') = 'true' THEN entry.amount ELSE 0 END), 0)", 'legacyPaidOut')
			.addSelect("COALESCE(SUM(CASE WHEN entry.type = 'payout' AND entry.status = 'paid_out' THEN ABS(entry.amount) ELSE 0 END), 0)", 'recordedPayouts')
			.addSelect("COALESCE(SUM(CASE WHEN entry.status = 'reversed' OR entry.type = 'refund' THEN ABS(entry.amount) ELSE 0 END), 0)", 'reversed')
			.addSelect('MIN(entry.currency)', 'currency')
			.where('entry.organizationId = :organizationId', { organizationId })
			.getRawOne<{ pending: string; available: string; legacyPaidOut: string; recordedPayouts: string; reversed: string }>();
		const pending = Number(totals?.pending || 0);
		const available = Number(totals?.available || 0);
		const paidOut = Number(totals?.legacyPaidOut || 0) + Number(totals?.recordedPayouts || 0);
		const reversed = Number(totals?.reversed || 0);
		return {
			currency: (totals as { currency?: string })?.currency || 'USD',
			pending: this.roundMoney(pending),
			available: this.roundMoney(available),
			paidOut: this.roundMoney(paidOut),
			reversed: this.roundMoney(reversed),
			totalEarned: this.roundMoney(pending + available + paidOut),
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

	async inspectOrganizationBalanceReconciliation(organizationId: string) {
		const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
		if (!organization) {
			throw new NotFoundException(`Organization with id "${organizationId}" was not found.`);
		}

		await this.syncOrganizationOrders(organizationId);
		await this.releaseAvailableEntries(organizationId);

		const currentBalance = await this.getBalance(organizationId, { synchronize: false });

		const paidOrders = await this.ticketOrdersRepository.find({
			where: { organization: { id: organizationId } },
			relations: { event: true, items: true },
			order: { paidAt: 'ASC', createdAt: 'ASC' },
		});

		let ordersGross = 0;
		let ordersBuyerPaid = 0;
		let ordersPlatformFee = 0;
		let ordersProcessingFee = 0;
		let ordersOrganizerPlatformFee = 0;
		let ordersOrganizerProcessingFee = 0;
		let ordersBuyerPlatformFee = 0;
		let ordersBuyerProcessingFee = 0;
		let ordersInfluencerCommission = 0;
		let ordersTax = 0;
		let ordersOrganizerNetTotal = 0;
		let ordersRefundedTotal = 0;
		let completedPaidOrdersCount = 0;
		let refundedOrdersCount = 0;
		let totalTicketsSold = 0;

		const orderIds: string[] = [];

		for (const order of paidOrders) {
			orderIds.push(order.id);
			if (order.status === 'paid') {
				completedPaidOrdersCount++;
				ordersGross += Number(order.subtotal || 0);
				ordersBuyerPaid += Number(order.total || 0);

				const opFee = Number(order.platformFee || 0);
				const prFee = Number(order.processingFee || 0);
				ordersPlatformFee += opFee;
				ordersProcessingFee += prFee;

				const bPlatform = this.feeSnapshotNumber(order, 'buyerPlatformFee', order.feePayer === 'buyer' ? opFee : 0);
				const bProc = this.feeSnapshotNumber(order, 'buyerProcessingFee', order.feePayer === 'buyer' ? prFee : 0);
				const oPlatform = this.feeSnapshotNumber(order, 'organizerPlatformFee', order.feePayer === 'organizer' ? opFee : Math.max(0, opFee - bPlatform));
				const oProc = this.feeSnapshotNumber(order, 'organizerProcessingFee', order.feePayer === 'organizer' ? prFee : Math.max(0, prFee - bProc));

				ordersBuyerPlatformFee += bPlatform;
				ordersBuyerProcessingFee += bProc;
				ordersOrganizerPlatformFee += oPlatform;
				ordersOrganizerProcessingFee += oProc;

				ordersInfluencerCommission += this.feeSnapshotNumber(order, 'influencerCommission', 0);
				ordersTax += Number(order.tax || 0);
				ordersOrganizerNetTotal += Number(order.organizerNet || 0);

				if (Array.isArray(order.items)) {
					for (const item of order.items) {
						totalTicketsSold += Number(item.quantity || 0);
					}
				}
			} else if (order.status === 'refunded') {
				refundedOrdersCount++;
				ordersRefundedTotal += Number(order.organizerNet || 0);
			}
		}

		// Account for partial and item refunds on paid orders
		let partialRefundsCount = 0;
		let partialRefundsDeduction = 0;
		if (orderIds.length > 0) {
			const successfulRefunds = await this.refundsRepository.createQueryBuilder('refund')
				.where('refund.orderId IN (:...orderIds)', { orderIds })
				.andWhere("refund.status IN ('succeeded', 'manually_reconciled')")
				.getMany();

			for (const refund of successfulRefunds) {
				const matchingOrder = paidOrders.find((o) => o.id === refund.orderId);
				// If order is already status='refunded', its full net was already excluded from ordersOrganizerNetTotal
				if (matchingOrder && matchingOrder.status === 'paid') {
					partialRefundsCount++;
					// The organizer net deduction for this refund
					const snapshot = refund.policySnapshot as any;
					const deductedNet = snapshot?.refundedSubtotal != null
						? Number(snapshot.refundedSubtotal)
						: Number(refund.amount || 0);
					partialRefundsDeduction += deductedNet;
				}
			}
		}

		ordersGross = this.roundMoney(ordersGross);
		ordersBuyerPaid = this.roundMoney(ordersBuyerPaid);
		ordersPlatformFee = this.roundMoney(ordersPlatformFee);
		ordersProcessingFee = this.roundMoney(ordersProcessingFee);
		ordersOrganizerPlatformFee = this.roundMoney(ordersOrganizerPlatformFee);
		ordersOrganizerProcessingFee = this.roundMoney(ordersOrganizerProcessingFee);
		ordersBuyerPlatformFee = this.roundMoney(ordersBuyerPlatformFee);
		ordersBuyerProcessingFee = this.roundMoney(ordersBuyerProcessingFee);
		ordersInfluencerCommission = this.roundMoney(ordersInfluencerCommission);
		ordersTax = this.roundMoney(ordersTax);
		ordersOrganizerNetTotal = this.roundMoney(ordersOrganizerNetTotal - partialRefundsDeduction);
		ordersRefundedTotal = this.roundMoney(ordersRefundedTotal + partialRefundsDeduction);

		const expectedNetEarnings = this.roundMoney(ordersOrganizerNetTotal);

		const rawLedgerStats = await this.ledgerRepository.createQueryBuilder('entry')
			.select("COALESCE(SUM(CASE WHEN entry.type = 'organizer_net' AND entry.status = 'available' THEN entry.amount ELSE 0 END), 0)", 'available')
			.addSelect("COALESCE(SUM(CASE WHEN entry.type = 'organizer_net' AND entry.status = 'pending' THEN entry.amount ELSE 0 END), 0)", 'pending')
			.addSelect("COALESCE(SUM(CASE WHEN entry.type = 'organizer_net' AND entry.status = 'paid_out' AND (entry.metadata->>'paidOutAutomaticallyByStripe') = 'true' THEN entry.amount ELSE 0 END), 0)", 'legacyPaidOut')
			.addSelect("COALESCE(SUM(CASE WHEN entry.type = 'payout' AND entry.status = 'paid_out' THEN ABS(entry.amount) ELSE 0 END), 0)", 'recordedPayouts')
			.addSelect("COALESCE(SUM(CASE WHEN entry.type = 'payout' AND entry.status IN ('pending', 'processing') THEN ABS(entry.amount) ELSE 0 END), 0)", 'pendingPayouts')
			.addSelect("COALESCE(SUM(CASE WHEN entry.status = 'reversed' OR entry.type = 'refund' THEN ABS(entry.amount) ELSE 0 END), 0)", 'reversed')
			.addSelect("COALESCE(SUM(CASE WHEN (entry.metadata->>'isReconciliationAdjustment') = 'true' THEN entry.amount ELSE 0 END), 0)", 'previousAdjustments')
			.where('entry.organizationId = :organizationId', { organizationId })
			.getRawOne<{
				available: string;
				pending: string;
				legacyPaidOut: string;
				recordedPayouts: string;
				pendingPayouts: string;
				reversed: string;
				previousAdjustments: string;
			}>();

		const ledgerAvailable = this.roundMoney(Number(rawLedgerStats?.available || 0));
		const ledgerPending = this.roundMoney(Number(rawLedgerStats?.pending || 0));
		const ledgerPaidOut = this.roundMoney(Number(rawLedgerStats?.legacyPaidOut || 0) + Number(rawLedgerStats?.recordedPayouts || 0));
		const ledgerReversed = this.roundMoney(Number(rawLedgerStats?.reversed || 0));
		const ledgerTotalEarned = this.roundMoney(ledgerAvailable + ledgerPending + ledgerPaidOut);
		const previousAdjustmentsTotal = this.roundMoney(Number(rawLedgerStats?.previousAdjustments || 0));

		const paidWithdrawals = await this.withdrawalRequestsRepository.find({
			where: { organization: { id: organizationId }, status: 'paid' },
		});
		const withdrawalPaidOutTotal = this.roundMoney(
			paidWithdrawals.reduce((sum, req) => sum + Number(req.netAmount ?? (Number(req.amount || 0) - Number(req.feeAmount || 0))), 0),
		);

		const pendingWithdrawals = await this.withdrawalRequestsRepository.find({
			where: { organization: { id: organizationId } },
		});
		const inFlightWithdrawals = pendingWithdrawals.filter((w) => ['pending_review', 'approved', 'processing'].includes(w.status));
		const inFlightWithdrawalTotal = this.roundMoney(
			inFlightWithdrawals.reduce((sum, req) => sum + Number(req.amount || 0), 0),
		);

		const discrepancy = this.roundMoney(expectedNetEarnings - ledgerTotalEarned);
		const isConsistent = Math.abs(discrepancy) < 0.01;

		return {
			organizationId: organization.id,
			organizationName: organization.name,
			organizationSlug: organization.slug,
			organizationType: organization.type,
			currency: 'USD',
			isConsistent,
			discrepancy,
			currentBalance: {
				available: currentBalance.available,
				pending: currentBalance.pending,
				paidOut: currentBalance.paidOut,
				reversed: currentBalance.reversed,
				totalEarned: currentBalance.totalEarned,
			},
			orderHistorySummary: {
				completedPaidOrdersCount,
				ticketsSold: totalTicketsSold,
				refundedOrdersCount,
				partialRefundsCount,
				partialRefundsDeduction: this.roundMoney(partialRefundsDeduction),
				grossSales: ordersGross,
				buyerPaid: ordersBuyerPaid,
				platformFees: ordersPlatformFee,
				processingFees: ordersProcessingFee,
				organizerPlatformFees: ordersOrganizerPlatformFee,
				organizerProcessingFees: ordersOrganizerProcessingFee,
				buyerPlatformFees: ordersBuyerPlatformFee,
				buyerProcessingFees: ordersBuyerProcessingFee,
				influencerCommissions: ordersInfluencerCommission,
				taxes: ordersTax,
				netEarnings: expectedNetEarnings,
				refundedNet: ordersRefundedTotal,
			},
			ledgerSummary: {
				available: ledgerAvailable,
				pending: ledgerPending,
				paidOut: ledgerPaidOut,
				reversed: ledgerReversed,
				totalEarned: ledgerTotalEarned,
				previousAdjustmentsTotal,
			},
			payoutSummary: {
				completedWithdrawalsCount: paidWithdrawals.length,
				totalPaidOutViaWithdrawals: withdrawalPaidOutTotal,
				inFlightWithdrawalsCount: inFlightWithdrawals.length,
				inFlightWithdrawalTotal,
			},
			recommendedAdjustment: isConsistent
				? null
				: {
						amount: discrepancy,
						targetStatus: 'available' as FinancialLedgerEntryStatus,
						action: discrepancy > 0 ? 'credit' : 'debit',
						suggestedReason: `Reconcile balance discrepancy of ${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)} between completed order net history (${expectedNetEarnings.toFixed(2)}) and financial ledger balance (${ledgerTotalEarned.toFixed(2)}).`,
					},
		};
	}

	async applyOrganizationBalanceReconciliation(
		organizationId: string,
		payload: { note: string; overrideAmount?: number },
		actor?: { id?: string; email?: string; role?: string },
	) {
		const note = payload?.note?.trim();
		if (!note || note.length < 5) {
			throw new BadRequestException('A descriptive admin reason / note (at least 5 characters) is required to record in the audit log.');
		}

		return this.ledgerRepository.manager.transaction(async (transactionManager) => {
			const organization = await transactionManager.findOne(OrganizationEntity, {
				where: { id: organizationId },
			});
			if (!organization) {
				throw new NotFoundException(`Organization with id "${organizationId}" was not found.`);
			}

			// Fresh inspection inside transaction to prevent race conditions
			const beforeInspection = await this.inspectOrganizationBalanceReconciliation(organizationId);
			const adjustmentAmount = typeof payload.overrideAmount === 'number' && Number.isFinite(payload.overrideAmount)
				? this.roundMoney(payload.overrideAmount)
				: beforeInspection.discrepancy;

			if (Math.abs(adjustmentAmount) < 0.01) {
				throw new BadRequestException('Balance is already consistent. No adjustment entry is required.');
			}

			const now = new Date();
			const idempotencyKey = `reconciliation-adjustment:${organizationId}:${Date.now()}`;
			const adjustmentEntry = transactionManager.create(FinancialLedgerEntryEntity, {
				idempotencyKey,
				organization,
				type: 'organizer_net',
				amount: adjustmentAmount,
				status: 'available',
				currency: 'USD',
				availableAt: now,
				metadata: {
					isReconciliationAdjustment: true,
					reconciliationReason: note,
					reconciledByUserId: actor?.id,
					reconciledByUserEmail: actor?.email,
					beforeBalance: beforeInspection.currentBalance,
					discrepancy: beforeInspection.discrepancy,
					orderNetTotal: beforeInspection.orderHistorySummary.netEarnings,
					resultingAvailableBalance: this.roundMoney(beforeInspection.currentBalance.available + adjustmentAmount),
					appliedAt: now.toISOString(),
				},
			});

			const savedAdjustment = await transactionManager.save(FinancialLedgerEntryEntity, adjustmentEntry);

			await this.releaseAvailableEntries(organizationId);
			const afterBalance = await this.getBalance(organizationId, { synchronize: false });

			await this.auditService.log(
				'user_balance.reconciled',
				actor,
				'organization',
				organizationId,
				{
					before: beforeInspection.currentBalance,
					after: afterBalance,
					adjustmentAmount,
					resultingAvailable: afterBalance.available,
					isNegativeBalance: afterBalance.available < 0,
					entryId: savedAdjustment.id,
				},
				{
					organizationId,
					organizationName: organization.name,
					reason: note,
					discrepancy: beforeInspection.discrepancy,
					orderNetTotal: beforeInspection.orderHistorySummary.netEarnings,
				},
			);

			return {
				success: true,
				adjustmentEntry: savedAdjustment,
				previousBalance: beforeInspection.currentBalance,
				updatedBalance: afterBalance,
				adjustmentAmount,
				isNegativeBalance: afterBalance.available < 0,
				note,
			};
		});
	}
}
