import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { FinancialLedgerService } from '../financial-ledger/financial-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationMemberEntity } from '../organizations/entities/organization-member.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { TicketOrderItemEntity } from '../ticket-orders/entities/ticket-order-item.entity';
import { WithdrawalRequestEntity } from './entities/withdrawal-request.entity';

type SalesUser = { id: string; email?: string; role: Role };

type SalesLine = {
	id: string;
	kind: 'ticket' | 'merchandise';
	itemId: string;
	name: string;
	quantity: number;
	unitPrice: number;
	gross: number;
	discount: number;
	influencerCommission: number;
	venueSpiceFee: number;
	processingFee: number;
	organizerNet: number;
	currency: string;
};

@Injectable()
export class OrganizerSalesService {
	constructor(
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(OrganizationMemberEntity)
		private readonly organizationMembersRepository: Repository<OrganizationMemberEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		@InjectRepository(TicketTypeEntity)
		private readonly ticketTypesRepository: Repository<TicketTypeEntity>,
		@InjectRepository(WithdrawalRequestEntity)
		private readonly withdrawalRequestsRepository: Repository<WithdrawalRequestEntity>,
		private readonly ledgerService: FinancialLedgerService,
		private readonly configService: ConfigService,
		private readonly auditService: AuditService,
		private readonly notificationsService: NotificationsService,
	) {}

	async summary(organizationId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		const orders = await this.getOrders(organizationId);
		const paidOrders = orders.filter((order) => order.status === 'paid');
		const refundedOrders = orders.filter((order) => order.status === 'refunded');
		const lines = paidOrders.flatMap((order) => this.buildOrderLines(order));
		const balance = await this.getAdjustedBalance(organizationId);

		return {
			currency: paidOrders[0]?.currency || orders[0]?.currency || 'USD',
			summary: {
				grossSales: this.sum(paidOrders, (order) => this.feeSnapshotNumber(order, 'grossSubtotal', Number(order.subtotal || 0))),
				buyerPaid: this.sum(paidOrders, (order) => Number(order.total || 0)),
				tax: this.sum(paidOrders, (order) => Number(order.tax || 0)),
				discounts: this.sum(paidOrders, (order) => this.feeSnapshotNumber(order, 'discountAmount', 0)),
				venueSpiceFees: this.sum(paidOrders, (order) => Number(order.platformFee || 0)),
				processingFees: this.sum(paidOrders, (order) => Number(order.processingFee || 0)),
				influencerCommission: this.sum(paidOrders, (order) => this.feeSnapshotNumber(order, 'influencerCommission', 0)),
				organizerNet: this.sum(paidOrders, (order) => Number(order.organizerNet || 0)),
				refunds: this.sum(refundedOrders, (order) => Number(order.total || 0)),
				ticketsSold: this.sum(lines.filter((line) => line.kind === 'ticket'), (line) => line.quantity),
				merchandiseSold: this.sum(lines.filter((line) => line.kind === 'merchandise'), (line) => line.quantity),
				orders: paidOrders.length,
			},
			balance: {
				pending: balance.pending,
				available: balance.available,
				paidOut: balance.paidOut,
				reversed: balance.reversed,
			},
			orders: paidOrders.slice(0, 8).map((order) => this.toOrderRow(order)),
			byEvent: this.groupLinesBy(lines, (line, order) => ({
				id: order.event?.id || 'unknown',
				name: order.event?.title || 'Event',
			}), paidOrders),
			byItemType: {
				tickets: this.summarizeLines(lines.filter((line) => line.kind === 'ticket')),
				merchandise: this.summarizeLines(lines.filter((line) => line.kind === 'merchandise')),
			},
			influencers: this.summarizeInfluencers(paidOrders),
		};
	}

	async orders(organizationId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		const orders = await this.getOrders(organizationId);
		return orders.map((order) => this.toOrderRow(order));
	}

	async orderDetail(organizationId: string, orderId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		const order = await this.ticketOrdersRepository.findOne({
			where: { id: orderId, organization: { id: organizationId } },
		});
		if (!order) throw new NotFoundException('Sale not found');
		return this.toOrderDetail(order);
	}

	async eventDetail(organizationId: string, eventId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		const orders = (await this.getOrders(organizationId)).filter((order) => order.event?.id === eventId);
		if (!orders.length) {
			return {
				eventId,
				summary: this.emptySummary(),
				orders: [],
				tickets: [],
				merchandise: [],
			};
		}
		const lines = orders.filter((order) => order.status === 'paid').flatMap((order) => this.buildOrderLines(order));
		return {
			eventId,
			event: {
				id: orders[0].event?.id,
				title: orders[0].event?.title,
				startsAt: orders[0].event?.startsAt,
				endsAt: orders[0].event?.endsAt,
			},
			summary: this.summarizeOrders(orders),
			orders: orders.map((order) => this.toOrderRow(order)),
			tickets: this.summarizeLines(lines.filter((line) => line.kind === 'ticket')),
			merchandise: this.summarizeLines(lines.filter((line) => line.kind === 'merchandise')),
		};
	}

	async ticketDetail(organizationId: string, ticketTypeId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		const orders = await this.getOrders(organizationId);
		const lines = orders.flatMap((order) =>
			this.buildOrderLines(order).filter((line) => line.kind === 'ticket' && line.itemId === ticketTypeId),
		);
		const ticketType = await this.ticketTypesRepository.findOne({
			where: { id: ticketTypeId },
			relations: { event: { organization: true } },
		});
		if (!lines.length && (!ticketType || ticketType.event?.organization?.id !== organizationId)) {
			throw new NotFoundException('Ticket not found');
		}
		const matchingOrders = lines.length
			? orders.filter((order) => lines.some((line) => line.id.split(':')[0] === order.id))
			: orders.filter((order) => order.items.some((item) => item.ticketType?.id === ticketTypeId));
		const name = ticketType?.name || lines[0]?.name || 'Ticket';
		return {
			ticket: ticketType ?? null,
			summary: this.summarizeLines(lines)[0] ?? this.emptyLineSummary(ticketTypeId, name, 'ticket'),
			orders: matchingOrders.map((order) => this.toOrderRow(order)),
			lines,
		};
	}

	async merchandiseDetail(organizationId: string, merchId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		const orders = await this.getOrders(organizationId);
		const lines = orders.flatMap((order) =>
			this.buildOrderLines(order).filter((line) => line.kind === 'merchandise' && line.itemId === merchId),
		);
		if (!lines.length) {
			return {
				merchandiseId: merchId,
				summary: this.emptyLineSummary(merchId, 'Merchandise', 'merchandise'),
				orders: [],
				lines: [],
			};
		}
		const orderIds = new Set(lines.map((line) => line.id.split(':')[0]));
		return {
			merchandiseId: merchId,
			summary: this.summarizeLines(lines)[0],
			orders: orders.filter((order) => orderIds.has(order.id)).map((order) => this.toOrderRow(order)),
			lines,
		};
	}

	async balance(organizationId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		return this.getAdjustedBalance(organizationId);
	}

	async listWithdrawalRequests(organizationId: string, user: SalesUser) {
		await this.ensureOrganizationAccess(organizationId, user);
		return this.withdrawalRequestsRepository.find({
			where: { organization: { id: organizationId } },
			order: { createdAt: 'DESC' },
		});
	}

	async requestWithdrawal(
		organizationId: string,
		user: SalesUser,
		payload?: { amount?: number; note?: string },
	) {
		const organization = await this.ensureOrganizationAccess(organizationId, user);
		if (!organization.stripeAccountId) {
			throw new BadRequestException('Connect Stripe before requesting a withdrawal.');
		}
		if (!organization.stripePayoutsEnabled && !organization.stripeAccountId.startsWith('acct_mock_')) {
			throw new BadRequestException('Finish Stripe payout setup before requesting a withdrawal.');
		}
		const entries = await this.ledgerService.getWithdrawableEntries(organizationId);
		const grossAvailable = this.roundMoney(entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
		const reserved = await this.getReservedWithdrawalAmount(organizationId);
		const available = this.roundMoney(Math.max(0, grossAvailable - reserved));
		const currency = entries[0]?.currency || 'USD';
		if (!entries.length || available <= 0) {
			throw new BadRequestException('No available balance to request yet.');
		}
		const amount = this.roundMoney(Number(payload?.amount || available));
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new BadRequestException('Withdrawal amount must be greater than zero.');
		}
		if (amount > available) {
			throw new BadRequestException('Withdrawal amount cannot exceed the available balance.');
		}
		const minimum = this.getMinimumWithdrawalAmount();
		if (amount < minimum) {
			throw new BadRequestException(`Minimum withdrawal amount is ${this.formatMoney(minimum, currency)}.`);
		}

		const request = await this.withdrawalRequestsRepository.save(
			this.withdrawalRequestsRepository.create({
				organization,
				status: 'pending_review',
				amount,
				currency,
				availableBalanceSnapshot: available,
				stripeAccountId: organization.stripeAccountId,
				requestedByUserId: user.id,
				requestedByEmail: user.email,
				requesterNote: payload?.note?.trim() || null,
				sourceEntryIds: entries.map((entry) => entry.id),
				metadata: {
					requestedAvailableBalance: available,
					grossAvailableBalance: grossAvailable,
					reservedBalance: reserved,
					sourceEntryCount: entries.length,
				},
			}),
		);
		await this.auditService.log(
			'organizer_withdrawal.requested',
			user,
			'withdrawal_request',
			request.id,
			{ amount, currency, organizationId },
			{ organizationId, availableBalanceSnapshot: available },
		);
		await this.notifyAdmins(
			'New Venue Spice withdrawal request',
			{
				eyebrow: 'Withdrawal request',
				title: 'New withdrawal request submitted',
				greeting: 'Hello team,',
				intro: `${organization.name} requested ${this.formatMoney(amount, currency)} for payout.`,
				rows: [
					{ label: 'Organizer', value: organization.name },
					{ label: 'Amount', value: this.formatMoney(amount, currency) },
					{ label: 'Requested by', value: user.email || organization.contactEmail || 'Unknown' },
					{ label: 'Available snapshot', value: this.formatMoney(available, currency) },
				],
				action: { label: 'Review withdrawals', url: this.adminUrl('/withdrawals') },
			},
		);
		await this.notifyOrganizer(
			organization,
			user.email,
			'Your Venue Spice withdrawal request was submitted',
			{
				eyebrow: 'Withdrawal request',
				title: 'Withdrawal request received',
				greeting: `Hello ${organization.name},`,
				intro: `Your withdrawal request for ${this.formatMoney(amount, currency)} has been submitted for admin review.`,
				rows: [
					{ label: 'Amount', value: this.formatMoney(amount, currency) },
					{ label: 'Status', value: 'Pending review' },
				],
				action: { label: 'Open account page', url: this.webUrl('/dashboard/account') },
			},
		);
		return request;
	}

	async listAdminWithdrawalRequests(status?: string) {
		return this.withdrawalRequestsRepository.find({
			where: status ? { status: status as never } : {},
			order: { createdAt: 'DESC' },
		});
	}

	async approveWithdrawalRequest(id: string, user: SalesUser, payload?: { note?: string }) {
		const request = await this.findWithdrawalRequest(id);
		if (!['pending_review', 'failed'].includes(request.status)) {
			throw new BadRequestException('Only pending or failed withdrawal requests can be approved.');
		}
		request.status = 'approved';
		request.reviewedByUserId = user.id;
		request.reviewedByEmail = user.email;
		request.reviewedAt = new Date();
		request.adminNote = payload?.note?.trim() || request.adminNote || null;
		const saved = await this.withdrawalRequestsRepository.save(request);
		await this.auditService.log(
			'organizer_withdrawal.approved',
			user,
			'withdrawal_request',
			saved.id,
			{ status: saved.status, amount: Number(saved.amount), currency: saved.currency },
			{ organizationId: saved.organization?.id },
		);
		await this.notifyOrganizer(saved.organization, saved.requestedByEmail, 'Your Venue Spice withdrawal was approved', {
			eyebrow: 'Withdrawal approved',
			title: 'Withdrawal request approved',
			greeting: `Hello ${saved.organization?.name || 'there'},`,
			intro: `Your withdrawal request for ${this.formatMoney(Number(saved.amount), saved.currency)} has been approved. The team will release it from the admin payout queue.`,
			rows: [
				{ label: 'Amount', value: this.formatMoney(Number(saved.amount), saved.currency) },
				{ label: 'Status', value: 'Approved' },
			],
		});
		return saved;
	}

	async rejectWithdrawalRequest(id: string, user: SalesUser, payload?: { note?: string }) {
		const request = await this.findWithdrawalRequest(id);
		if (!['pending_review', 'approved', 'failed'].includes(request.status)) {
			throw new BadRequestException('This withdrawal request can no longer be rejected.');
		}
		request.status = 'rejected';
		request.reviewedByUserId = user.id;
		request.reviewedByEmail = user.email;
		request.reviewedAt = new Date();
		request.adminNote = payload?.note?.trim() || request.adminNote || null;
		const saved = await this.withdrawalRequestsRepository.save(request);
		await this.auditService.log(
			'organizer_withdrawal.rejected',
			user,
			'withdrawal_request',
			saved.id,
			{ status: saved.status, amount: Number(saved.amount), currency: saved.currency },
			{ organizationId: saved.organization?.id, adminNote: saved.adminNote },
		);
		await this.notifyOrganizer(saved.organization, saved.requestedByEmail, 'Your Venue Spice withdrawal was rejected', {
			eyebrow: 'Withdrawal rejected',
			title: 'Withdrawal request rejected',
			greeting: `Hello ${saved.organization?.name || 'there'},`,
			intro: `Your withdrawal request for ${this.formatMoney(Number(saved.amount), saved.currency)} was rejected.`,
			rows: [
				{ label: 'Amount', value: this.formatMoney(Number(saved.amount), saved.currency) },
				{ label: 'Reason', value: saved.adminNote || 'No reason provided' },
			],
		});
		return saved;
	}

	async payWithdrawalRequest(id: string, user: SalesUser) {
		const request = await this.findWithdrawalRequest(id);
		if (!['pending_review', 'approved', 'failed'].includes(request.status)) {
			throw new BadRequestException('This withdrawal request is not payable.');
		}
		const organization = request.organization;
		if (!organization?.stripeAccountId) {
			throw new BadRequestException('Organizer Stripe account is missing.');
		}
		if (!organization.stripePayoutsEnabled && !organization.stripeAccountId.startsWith('acct_mock_')) {
			throw new BadRequestException('Organizer Stripe payout setup is not complete.');
		}
		const amount = this.roundMoney(Number(request.amount || 0));
		const currency = request.currency || 'USD';
		const entries = await this.ledgerService.prepareWithdrawableEntries(
			organization.id,
			amount,
			request.sourceEntryIds ?? undefined,
		);
		if (!entries.length) {
			throw new BadRequestException('Available ledger balance is no longer enough to pay this request.');
		}

		request.status = 'processing';
		request.reviewedByUserId = user.id;
		request.reviewedByEmail = user.email;
		request.reviewedAt = request.reviewedAt ?? new Date();
		request.sourceEntryIds = entries.map((entry) => entry.id);
		await this.withdrawalRequestsRepository.save(request);

		if (organization.stripeAccountId.startsWith('acct_mock_')) {
			const payout = await this.ledgerService.recordPayoutSuccess(
				organization.id,
				entries,
				amount,
				currency,
				{
					mode: 'mock',
					mockTransferId: `tr_mock_${Date.now()}`,
					destination: organization.stripeAccountId,
					withdrawalRequestId: request.id,
				},
				user,
			);
			request.status = 'paid';
			request.paidAt = new Date();
			request.metadata = { ...(request.metadata ?? {}), payoutId: payout?.id, mode: 'mock' };
			const saved = await this.withdrawalRequestsRepository.save(request);
			await this.auditService.log('organizer_withdrawal.paid', user, 'withdrawal_request', saved.id, { amount, currency }, { organizationId: organization.id, mode: 'mock' });
			await this.notifyOrganizerPayoutPaid(saved);
			return saved;
		}

		try {
			const transfer = await this.createStripeTransfer(organization.stripeAccountId, amount, currency, organization.id, request.id);
			const payout = await this.ledgerService.recordPayoutSuccess(
				organization.id,
				entries,
				amount,
				currency,
				{
					mode: 'stripe_transfer',
					stripeTransferId: transfer.id,
					destination: organization.stripeAccountId,
					stripePayload: transfer,
					withdrawalRequestId: request.id,
				},
				user,
			);
			request.status = 'paid';
			request.paidAt = new Date();
			request.stripeTransferId = transfer.id;
			request.metadata = { ...(request.metadata ?? {}), payoutId: payout?.id, mode: 'stripe_transfer' };
			const saved = await this.withdrawalRequestsRepository.save(request);
			await this.auditService.log('organizer_withdrawal.paid', user, 'withdrawal_request', saved.id, { amount, currency }, { organizationId: organization.id, stripeTransferId: transfer.id });
			await this.notifyOrganizerPayoutPaid(saved);
			return saved;
		} catch (error) {
			const stripeMessage = error instanceof Error ? error.message : 'Stripe transfer failed.';
			const message = this.friendlyStripeTransferError(stripeMessage);
			await this.ledgerService.recordPayoutFailure(
				organization.id,
				entries,
				amount,
				currency,
				message,
				user,
				{ destination: organization.stripeAccountId, withdrawalRequestId: request.id, stripeErrorMessage: stripeMessage },
			);
			request.status = 'failed';
			request.failedAt = new Date();
			request.adminNote = message;
			request.metadata = { ...(request.metadata ?? {}), errorMessage: message, stripeErrorMessage: stripeMessage };
			await this.withdrawalRequestsRepository.save(request);
			await this.auditService.log('organizer_withdrawal.failed', user, 'withdrawal_request', request.id, { amount, currency, errorMessage: message }, { organizationId: organization.id });
			await this.notifyAdmins('Venue Spice withdrawal payout failed', {
				eyebrow: 'Payout failed',
				title: 'Withdrawal payout failed',
				greeting: 'Hello team,',
				intro: `${organization.name}'s withdrawal payout could not be sent.`,
				rows: [
					{ label: 'Organizer', value: organization.name },
					{ label: 'Amount', value: this.formatMoney(amount, currency) },
					{ label: 'Reason', value: message },
				],
				action: { label: 'Review withdrawals', url: this.adminUrl('/withdrawals') },
			});
			await this.notifyOrganizer(organization, request.requestedByEmail, 'Your Venue Spice payout is delayed', {
				eyebrow: 'Payout delayed',
				title: 'Your payout needs review',
				greeting: `Hello ${organization.name},`,
				intro: `Your payout request for ${this.formatMoney(amount, currency)} could not be completed yet. Our team has been notified and will review it.`,
				rows: [{ label: 'Reason', value: message }],
			});
			throw new BadRequestException(message);
		}
	}

	async getStripePlatformBalance() {
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		if (!secretKey) {
			throw new BadRequestException('Stripe is not configured on this server.');
		}
		const response = await fetch('https://api.stripe.com/v1/balance', {
			headers: { Authorization: `Bearer ${secretKey}` },
		});
		const payload = await response.json() as {
			available?: Array<{ amount: number; currency: string; source_types?: Record<string, number> }>;
			pending?: Array<{ amount: number; currency: string; source_types?: Record<string, number> }>;
			error?: { message?: string };
		};
		if (!response.ok) {
			throw new BadRequestException(payload.error?.message ?? 'Unable to fetch Stripe balance.');
		}
		const normalize = (items?: Array<{ amount: number; currency: string; source_types?: Record<string, number> }>) =>
			(items ?? []).map((item) => ({
				amount: this.roundMoney(Number(item.amount || 0) / 100),
				currency: String(item.currency || 'usd').toUpperCase(),
				sourceTypes: item.source_types ?? {},
			}));
		return {
			available: normalize(payload.available),
			pending: normalize(payload.pending),
		};
	}

	async createStripeDashboardLink(organizationId: string, user: SalesUser) {
		const organization = await this.ensureOrganizationAccess(organizationId, user);
		if (!organization.stripeAccountId) {
			throw new BadRequestException('Connect Stripe before opening the payout dashboard.');
		}
		if (organization.stripeAccountId.startsWith('acct_mock_')) {
			return {
				url: this.configService.get<string>('STRIPE_DASHBOARD_URL', 'https://dashboard.stripe.com/test/dashboard'),
				mode: 'mock',
			};
		}
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		if (!secretKey) {
			throw new BadRequestException('Stripe is not configured on this server.');
		}
		const response = await fetch(
			`https://api.stripe.com/v1/accounts/${encodeURIComponent(organization.stripeAccountId)}/login_links`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${secretKey}`,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			},
		);
		const payload = await response.json() as { url?: string; error?: { message?: string } };
		if (!response.ok || !payload.url) {
			throw new BadRequestException(payload.error?.message ?? 'Unable to create Stripe dashboard link.');
		}
		return { url: payload.url, mode: 'live' };
	}

	private async findWithdrawalRequest(id: string) {
		const request = await this.withdrawalRequestsRepository.findOne({ where: { id } });
		if (!request) throw new NotFoundException('Withdrawal request not found');
		return request;
	}

	private async getAdjustedBalance(organizationId: string) {
		const balance = await this.ledgerService.getBalance(organizationId);
		const reserved = await this.getReservedWithdrawalAmount(organizationId);
		const grossAvailable = Number(balance.available || 0);
		const withdrawable = this.roundMoney(Math.max(0, grossAvailable - reserved));
		return {
			...balance,
			grossAvailable: this.roundMoney(grossAvailable),
			reserved: this.roundMoney(reserved),
			withdrawable,
			available: withdrawable,
		};
	}

	private async getReservedWithdrawalAmount(organizationId: string) {
		const requests = await this.withdrawalRequestsRepository.find({
			where: {
				organization: { id: organizationId },
				status: In(['pending_review', 'approved', 'processing']),
			},
		});
		return this.roundMoney(requests.reduce((sum, request) => sum + Number(request.amount || 0), 0));
	}

	private async createStripeTransfer(accountId: string, amount: number, currency: string, organizationId: string, withdrawalRequestId?: string) {
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		if (!secretKey) {
			throw new BadRequestException('Stripe is not configured on this server.');
		}
		const params = new URLSearchParams();
		params.set('amount', String(Math.round(amount * 100)));
		params.set('currency', currency.toLowerCase());
		params.set('destination', accountId);
		params.set('metadata[organizationId]', organizationId);
		params.set('metadata[source]', 'venue_spice_organizer_withdrawal');
		if (withdrawalRequestId) params.set('metadata[withdrawalRequestId]', withdrawalRequestId);

		const response = await fetch('https://api.stripe.com/v1/transfers', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params,
		});
		const payload = await response.json() as { id?: string; error?: { message?: string } };
		if (!response.ok || !payload.id) {
			throw new BadRequestException(payload.error?.message ?? 'Unable to transfer available balance.');
		}
		return payload;
	}

	private async getOrders(organizationId: string) {
		await this.ledgerService.syncOrganizationOrders(organizationId);
		return this.ticketOrdersRepository.find({
			where: { organization: { id: organizationId } },
			order: { paidAt: 'DESC', createdAt: 'DESC' },
		});
	}

	private toOrderRow(order: TicketOrderEntity) {
		const lines = this.buildOrderLines(order);
		return {
			id: order.id,
			eventId: order.event?.id,
			eventTitle: order.event?.title || 'Event',
			customerName: order.customerName,
			customerEmail: order.customerEmail,
			status: order.status,
			paidAt: this.toIso(order.paidAt || order.createdAt),
			currency: order.currency,
			buyerPaid: Number(order.total || 0),
			grossSales: this.feeSnapshotNumber(order, 'grossSubtotal', Number(order.subtotal || 0)),
			tax: Number(order.tax || 0),
			discounts: this.feeSnapshotNumber(order, 'discountAmount', 0),
			venueSpiceFees: Number(order.platformFee || 0),
			processingFees: Number(order.processingFee || 0),
			influencerCommission: this.feeSnapshotNumber(order, 'influencerCommission', 0),
			organizerNet: Number(order.organizerNet || 0),
			feePayer: order.feePayer,
			couponCode: order.referralCode?.code ?? this.feeSnapshotString(order, 'discountCode'),
			ticketQuantity: lines.filter((line) => line.kind === 'ticket').reduce((sum, line) => sum + line.quantity, 0),
			merchandiseQuantity: lines.filter((line) => line.kind === 'merchandise').reduce((sum, line) => sum + line.quantity, 0),
		};
	}

	private toOrderDetail(order: TicketOrderEntity) {
		return {
			...this.toOrderRow(order),
			stripeCheckoutSessionId: order.stripeCheckoutSessionId,
			stripePaymentIntentId: order.stripePaymentIntentId,
			termsAcceptedAt: this.toIso(order.termsAcceptedAt),
			createdAt: this.toIso(order.createdAt),
			updatedAt: this.toIso(order.updatedAt),
			event: order.event,
			organization: order.organization,
			items: this.buildOrderLines(order),
			feeSnapshot: order.feeSnapshot,
			providerPayload: order.providerPayload,
		};
	}

	private buildOrderLines(order: TicketOrderEntity): SalesLine[] {
		const ticketGross = order.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
		const addOns = this.getOrderAddOns(order);
		const addOnGross = addOns.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
		const grossSubtotal = this.feeSnapshotNumber(order, 'grossSubtotal', ticketGross + addOnGross);
		const discountAmount = this.feeSnapshotNumber(order, 'discountAmount', 0);
		const influencerCommission = this.feeSnapshotNumber(order, 'influencerCommission', 0);
		const platformFee = Number(order.platformFee || 0);
		const processingFee = Number(order.processingFee || 0);
		const organizerNet = Number(order.organizerNet || 0);
		const allocate = (gross: number) => {
			const ratio = grossSubtotal > 0 ? gross / grossSubtotal : 0;
			return {
				discount: this.roundMoney(discountAmount * ratio),
				influencerCommission: this.roundMoney(influencerCommission * ratio),
				venueSpiceFee: this.roundMoney(platformFee * ratio),
				processingFee: this.roundMoney(processingFee * ratio),
				organizerNet: this.roundMoney(organizerNet * ratio),
			};
		};
		const tickets = order.items.map((item): SalesLine => {
			const gross = Number(item.lineTotal || 0);
			const money = allocate(gross);
			return {
				id: `${order.id}:${item.id}`,
				kind: 'ticket',
				itemId: item.ticketType?.id || item.id,
				name: item.ticketName,
				quantity: item.quantity,
				unitPrice: Number(item.unitPrice || 0),
				gross,
				currency: order.currency,
				...money,
			};
		});
		const merch = addOns.map((item): SalesLine => {
			const gross = Number(item.lineTotal || 0);
			const money = allocate(gross);
			return {
				id: `${order.id}:${item.id}`,
				kind: 'merchandise',
				itemId: item.id,
				name: item.name,
				quantity: item.quantity,
				unitPrice: item.unitPrice,
				gross,
				currency: order.currency,
				...money,
			};
		});
		return [...tickets, ...merch];
	}

	private getOrderAddOns(order: TicketOrderEntity) {
		const addOns = order.feeSnapshot?.addOns;
		if (!Array.isArray(addOns)) return [];
		return addOns.map((item) => {
			const record = item as Record<string, unknown>;
			const quantity = Number(record.quantity || 0);
			const unitPrice = Number(record.unitPrice || 0);
			return {
				id: String(record.id || record.name || 'add-on'),
				name: String(record.name || 'Merchandise'),
				quantity,
				unitPrice,
				lineTotal: Number(record.lineTotal ?? quantity * unitPrice),
			};
		}).filter((item) => item.quantity > 0);
	}

	private summarizeOrders(orders: TicketOrderEntity[]) {
		const paid = orders.filter((order) => order.status === 'paid');
		const refunded = orders.filter((order) => order.status === 'refunded');
		return {
			...this.emptySummary(),
			grossSales: this.sum(paid, (order) => this.feeSnapshotNumber(order, 'grossSubtotal', Number(order.subtotal || 0))),
			buyerPaid: this.sum(paid, (order) => Number(order.total || 0)),
			tax: this.sum(paid, (order) => Number(order.tax || 0)),
			discounts: this.sum(paid, (order) => this.feeSnapshotNumber(order, 'discountAmount', 0)),
			venueSpiceFees: this.sum(paid, (order) => Number(order.platformFee || 0)),
			processingFees: this.sum(paid, (order) => Number(order.processingFee || 0)),
			influencerCommission: this.sum(paid, (order) => this.feeSnapshotNumber(order, 'influencerCommission', 0)),
			organizerNet: this.sum(paid, (order) => Number(order.organizerNet || 0)),
			refunds: this.sum(refunded, (order) => Number(order.total || 0)),
			orders: paid.length,
		};
	}

	private summarizeLines(lines: SalesLine[]) {
		const buckets = new Map<string, {
			id: string;
			name: string;
			kind: SalesLine['kind'];
			quantity: number;
			gross: number;
			discount: number;
			influencerCommission: number;
			venueSpiceFee: number;
			processingFee: number;
			organizerNet: number;
			currency: string;
		}>();
		for (const line of lines) {
			const key = `${line.kind}:${line.itemId}`;
			const bucket = buckets.get(key) ?? {
				id: line.itemId,
				name: line.name,
				kind: line.kind,
				quantity: 0,
				gross: 0,
				discount: 0,
				influencerCommission: 0,
				venueSpiceFee: 0,
				processingFee: 0,
				organizerNet: 0,
				currency: line.currency,
			};
			bucket.quantity += line.quantity;
			bucket.gross += line.gross;
			bucket.discount += line.discount;
			bucket.influencerCommission += line.influencerCommission;
			bucket.venueSpiceFee += line.venueSpiceFee;
			bucket.processingFee += line.processingFee;
			bucket.organizerNet += line.organizerNet;
			buckets.set(key, bucket);
		}
		return Array.from(buckets.values()).map((bucket) => this.roundSummary(bucket));
	}

	private groupLinesBy(
		lines: SalesLine[],
		getIdentity: (line: SalesLine, order: TicketOrderEntity) => { id: string; name: string },
		orders: TicketOrderEntity[],
	) {
		const orderById = new Map(orders.map((order) => [order.id, order]));
		const buckets = new Map<string, { id: string; name: string; gross: number; organizerNet: number; quantity: number }>();
		for (const line of lines) {
			const order = orderById.get(line.id.split(':')[0]);
			if (!order) continue;
			const identity = getIdentity(line, order);
			const bucket = buckets.get(identity.id) ?? { ...identity, gross: 0, organizerNet: 0, quantity: 0 };
			bucket.gross += line.gross;
			bucket.organizerNet += line.organizerNet;
			bucket.quantity += line.quantity;
			buckets.set(identity.id, bucket);
		}
		return Array.from(buckets.values()).map((bucket) => this.roundSummary(bucket));
	}

	private summarizeInfluencers(orders: TicketOrderEntity[]) {
		const buckets = new Map<string, { code: string; gross: number; commission: number; orders: number }>();
		for (const order of orders) {
			const code = order.referralCode?.code ?? this.feeSnapshotString(order, 'discountCode');
			if (!code) continue;
			const bucket = buckets.get(code) ?? { code, gross: 0, commission: 0, orders: 0 };
			bucket.gross += this.feeSnapshotNumber(order, 'grossSubtotal', Number(order.subtotal || 0));
			bucket.commission += this.feeSnapshotNumber(order, 'influencerCommission', 0);
			bucket.orders += 1;
			buckets.set(code, bucket);
		}
		return Array.from(buckets.values()).map((bucket) => this.roundSummary(bucket));
	}

	private async ensureOrganizationAccess(organizationId: string, user: SalesUser) {
		if (!organizationId) throw new BadRequestException('Organization is required');
		const organization = await this.organizationsRepository.findOne({ where: { id: organizationId } });
		if (!organization) throw new NotFoundException('Organization not found');
		if (this.isAdminRole(user.role) || organization.ownerUserId === user.id) return organization;
		const membership = await this.organizationMembersRepository.findOne({
			where: {
				organization: { id: organizationId },
				userId: user.id,
				status: 'active',
			},
		});
		if (membership) return organization;
		throw new ForbiddenException('You cannot access this organizer sales data');
	}

	private isAdminRole(role: Role) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN].includes(role);
	}

	private friendlyStripeTransferError(message: string) {
		const lower = message.toLowerCase();
		if (lower.includes('insufficient funds') || lower.includes('balance is too low')) {
			return 'Stripe balance is not enough to pay this withdrawal yet. Please fund the Stripe account or wait for pending Stripe balance to become available, then retry payout.';
		}
		return message || 'Stripe transfer failed. Please review the payout and try again.';
	}

	private async notifyAdmins(subject: string, options: Parameters<NotificationsService['buildBrandedEmail']>[0]) {
		const admins = await this.usersRepository.find({
			where: { role: In([Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]), isActive: true },
		});
		await Promise.allSettled(
			admins
				.map((admin) => admin.email)
				.filter(Boolean)
				.map((email) => this.notificationsService.queueEmail(email, subject, this.notificationsService.buildBrandedEmail(options))),
		);
	}

	private async notifyOrganizer(
		organization: OrganizationEntity | undefined,
		fallbackEmail: string | undefined | null,
		subject: string,
		options: Parameters<NotificationsService['buildBrandedEmail']>[0],
	) {
		const email = fallbackEmail || organization?.contactEmail || await this.getOrganizationOwnerEmail(organization);
		if (!email) return;
		await this.notificationsService.queueEmail(email, subject, this.notificationsService.buildBrandedEmail(options));
	}

	private async notifyOrganizerPayoutPaid(request: WithdrawalRequestEntity) {
		await this.notifyOrganizer(request.organization, request.requestedByEmail, 'Your Venue Spice payout has been sent', {
			eyebrow: 'Payout sent',
			title: 'Your payout has been sent',
			greeting: `Hello ${request.organization?.name || 'there'},`,
			intro: `Your payout of ${this.formatMoney(Number(request.amount), request.currency)} has been sent.`,
			rows: [
				{ label: 'Amount', value: this.formatMoney(Number(request.amount), request.currency) },
				{ label: 'Status', value: 'Paid' },
				{ label: 'Stripe transfer', value: request.stripeTransferId || 'Processed' },
			],
		});
	}

	private async getOrganizationOwnerEmail(organization?: OrganizationEntity) {
		if (!organization?.ownerUserId) return null;
		const owner = await this.usersRepository.findOne({ where: { id: organization.ownerUserId } });
		return owner?.email || null;
	}

	private webUrl(path: string) {
		return `${this.configService.get<string>('FRONTEND_URL', 'https://venuespice.com')}${path}`;
	}

	private adminUrl(path: string) {
		return `${this.configService.get<string>('ADMIN_URL', 'https://admin.venuespice.com')}${path}`;
	}

	private getMinimumWithdrawalAmount() {
		const value = Number(this.configService.get<string>('MIN_WITHDRAWAL_AMOUNT', '10'));
		return Number.isFinite(value) && value > 0 ? this.roundMoney(value) : 10;
	}

	private formatMoney(amount: number, currency: string) {
		return `${currency.toUpperCase()} ${this.roundMoney(amount).toFixed(2)}`;
	}

	private emptySummary() {
		return {
			grossSales: 0,
			buyerPaid: 0,
			tax: 0,
			discounts: 0,
			venueSpiceFees: 0,
			processingFees: 0,
			influencerCommission: 0,
			organizerNet: 0,
			refunds: 0,
			orders: 0,
		};
	}

	private emptyLineSummary(id: string, name: string, kind: SalesLine['kind']) {
		return this.roundSummary({
			id,
			name,
			kind,
			quantity: 0,
			gross: 0,
			discount: 0,
			influencerCommission: 0,
			venueSpiceFee: 0,
			processingFee: 0,
			organizerNet: 0,
			currency: 'USD',
		});
	}

	private feeSnapshotNumber(order: TicketOrderEntity, key: string, fallback: number) {
		const numeric = Number(order.feeSnapshot?.[key]);
		return Number.isFinite(numeric) ? numeric : fallback;
	}

	private feeSnapshotString(order: TicketOrderEntity, key: string) {
		const value = order.feeSnapshot?.[key];
		return typeof value === 'string' ? value : null;
	}

	private sum<T>(items: T[], getValue: (item: T) => number) {
		return this.roundMoney(items.reduce((total, item) => total + Number(getValue(item) || 0), 0));
	}

	private roundSummary<T extends Record<string, unknown>>(record: T) {
		const next = { ...record };
		for (const key of ['gross', 'buyerPaid', 'tax', 'discount', 'discounts', 'commission', 'influencerCommission', 'venueSpiceFee', 'venueSpiceFees', 'processingFee', 'processingFees', 'organizerNet', 'refunds']) {
			if (key in next) {
				next[key as keyof T] = this.roundMoney(Number(next[key] || 0)) as T[keyof T];
			}
		}
		return next;
	}

	private roundMoney(value: number) {
		return Math.round((Number(value) || 0) * 100) / 100;
	}

	private toIso(value?: Date | string | null) {
		if (!value) return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
}
