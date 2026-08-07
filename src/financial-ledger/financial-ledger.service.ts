import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import {
	FinancialLedgerEntryEntity,
	FinancialLedgerEntryStatus,
	FinancialLedgerEntryType,
} from './entities/financial-ledger-entry.entity';

@Injectable()
export class FinancialLedgerService {
	constructor(
		@InjectRepository(FinancialLedgerEntryEntity)
		private readonly ledgerRepository: Repository<FinancialLedgerEntryEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
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

		const availableAt = this.calculateAvailableAt(order);
		const status: FinancialLedgerEntryStatus = availableAt.getTime() <= Date.now()
			? 'available'
			: 'pending';

		const entries: Array<{
			type: FinancialLedgerEntryType;
			amount: number;
			status: FinancialLedgerEntryStatus;
			metadata?: Record<string, unknown>;
		}> = [
			{ type: 'gross_sale', amount: Number(order.subtotal || 0), status },
			{ type: 'tax', amount: Number(order.tax || 0), status },
			{ type: 'platform_fee', amount: -Number(order.platformFee || 0), status },
			{ type: 'processing_fee', amount: -Number(order.processingFee || 0), status },
			{
				type: 'influencer_commission',
				amount: -this.feeSnapshotNumber(order, 'influencerCommission', 0),
				status,
				metadata: {
					referralCode: order.referralCode?.code ?? null,
					agentId: order.referralCode?.agent?.id ?? null,
				},
			},
			{ type: 'organizer_net', amount: Number(order.organizerNet || 0), status },
		];

		for (const entry of entries) {
			if (Math.abs(entry.amount) <= 0) continue;
			await this.upsertOrderEntry(order, entry.type, entry.amount, entry.status, availableAt, entry.metadata);
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

	async getOrganizationEntries(organizationId: string) {
		await this.syncOrganizationOrders(organizationId);
		return this.ledgerRepository.find({
			where: { organization: { id: organizationId } },
			order: { createdAt: 'DESC' },
		});
	}

	async getBalance(organizationId: string) {
		const entries = await this.getOrganizationEntries(organizationId);
		const organizerEntries = entries.filter((entry) =>
			['organizer_net', 'refund', 'payout'].includes(entry.type),
		);
		const pending = this.sum(
			organizerEntries.filter((entry) => entry.status === 'pending'),
		);
		const available = this.sum(
			organizerEntries.filter((entry) => entry.status === 'available'),
		);
		const paidOut = Math.abs(this.sum(
			organizerEntries.filter((entry) => entry.status === 'paid_out' || entry.type === 'payout'),
		));
		const reversed = Math.abs(this.sum(
			organizerEntries.filter((entry) => entry.status === 'reversed' || entry.type === 'refund'),
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

	private async releaseAvailableEntries(organizationId: string) {
		await this.ledgerRepository.update(
			{
				organization: { id: organizationId },
				status: 'pending',
				availableAt: LessThanOrEqual(new Date()),
			},
			{ status: 'available' },
		);
	}

	private calculateAvailableAt(order: TicketOrderEntity) {
		const holdDays = this.getHoldDays();
		const base = order.event?.endsAt || order.event?.startsAt || order.paidAt || order.createdAt || new Date();
		const date = new Date(base);
		if (Number.isNaN(date.getTime())) return new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
		date.setDate(date.getDate() + holdDays);
		return date;
	}

	private getHoldDays() {
		const raw = Number(process.env.ORGANIZER_PAYOUT_HOLD_DAYS ?? process.env.INFLUENCER_EARNINGS_HOLD_DAYS ?? 7);
		return Number.isFinite(raw) && raw >= 0 ? raw : 7;
	}

	private feeSnapshotNumber(order: TicketOrderEntity, key: string, fallback: number) {
		const value = order.feeSnapshot?.[key];
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : fallback;
	}

	private sum(entries: FinancialLedgerEntryEntity[]) {
		return entries.reduce((total, entry) => total + Number(entry.amount || 0), 0);
	}

	private roundMoney(value: number) {
		return Math.round((Number(value) || 0) * 100) / 100;
	}
}
