import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { PaymentIntentEntity } from '../payments/entities/payment-intent.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { IssuedTicketEntity } from '../ticket-orders/entities/issued-ticket.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { refundBreakdown, adminRefundBreakdown, RefundAmounts, RefundReason } from './refund-policy';
import { AdminRefundDto } from './dto/admin-refund.dto';
import { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import { ReviewRefundRequestDto } from './dto/review-refund-request.dto';
import { RefundEmailEntity } from './entities/refund-email.entity';
import { RefundRequestEntity } from './entities/refund-request.entity';

type StripeRefund = {
	id: string;
	status?: string;
	amount?: number;
	currency?: string;
	payment_intent?: string;
	error?: { message?: string; type?: string };
};

@Injectable()
export class RefundsService {
 private readonly logger = new Logger(RefundsService.name);
 private reconciling = false;
	constructor(
		@InjectRepository(RefundRequestEntity)
		private readonly refundsRepository: Repository<RefundRequestEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		@InjectRepository(IssuedTicketEntity)
		private readonly issuedTicketsRepository: Repository<IssuedTicketEntity>,
		@InjectRepository(TicketTypeEntity)
		private readonly ticketTypesRepository: Repository<TicketTypeEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(PaymentIntentEntity)
		private readonly paymentIntentsRepository: Repository<PaymentIntentEntity>,
		private readonly configService: ConfigService,
		private readonly auditService: AuditService,
		private readonly notificationsService: NotificationsService,
	) {}

 private assertPlatformAdmin(actor: {role: Role}) {
  if (!this.isAdminRole(actor.role)) throw new ForbiddenException('Platform administrator access required');
 }
 private async verifyAdminPayment(order: TicketOrderEntity) {
  const secret=this.requireStripePayment(order);
  const get=async(path:string)=>{
   const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:'GET',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(10000)});
   if(!response.ok) throw new BadRequestException('Unable to verify the original Stripe payment. No refund issued.');
   return response.json();
  };
  const payment=await get(`payment_intents/${encodeURIComponent(order.stripePaymentIntentId!)}?expand[]=latest_charge`);
  if(payment.id!==order.stripePaymentIntentId || payment.status!=='succeeded' || payment.currency?.toLowerCase()!==order.currency.toLowerCase() || payment.amount_received!==Math.round(Number(order.total)*100)) throw new BadRequestException('Stripe payment does not match the paid order. Reconcile it before issuing a refund.');
  if(!payment.latest_charge || typeof payment.latest_charge!=='object' || payment.latest_charge.disputed || payment.latest_charge.amount_refunded>0) throw new BadRequestException('Payment has a dispute, existing refund, or incomplete charge details. Review reconciliation first.');
  const refunds=await get(`refunds?${new URLSearchParams({payment_intent:order.stripePaymentIntentId!,limit:'100'})}`);
  if(!Array.isArray(refunds.data) || refunds.has_more || refunds.data.some((r:{status:string})=>!['failed','canceled'].includes(r.status))) throw new BadRequestException('Stripe already has a refund for this payment. Review reconciliation first.');
 }
 async adminPreview(orderId:string,actor:{role:Role},cancellationReason:RefundReason = 'voluntary', refundAmounts?:RefundAmounts, requestId?:string) {
  this.assertPlatformAdmin(actor);
  const order=await this.ticketOrdersRepository.findOne({where:{id:orderId}});
  if(!order) throw new NotFoundException('Ticket order not found');
  this.ensureOrderCanBeRefunded(order,cancellationReason);
  const existing=await this.refundsRepository.find({where:{orderId}});
  if(requestId && !existing.some(r=>r.id===requestId && r.status==='requested')) throw new BadRequestException('This request is no longer awaiting approval');
  if(existing.some(r=>r.id!==requestId && !['failed','declined'].includes(r.status))) throw new BadRequestException('An active or completed refund exists. Review that request instead.');
  await this.verifyAdminPayment(order);
  return {orderId:order.id,customerEmail:order.customerEmail,customerName:order.customerName,eventTitle:order.event.title,currency:order.currency,...adminRefundBreakdown(order,cancellationReason,refundAmounts),taxProvider:order.taxProvider,allTicketsInvalidated:adminRefundBreakdown(order,cancellationReason,refundAmounts).refundComponents.tickets>0};
 }
 async previewRequest(id:string,actor:{role:Role},cancellationReason:RefundReason='voluntary') {
  this.assertPlatformAdmin(actor);
  const refund=await this.refundsRepository.findOne({where:{id}});
  if(!refund) throw new NotFoundException('Refund request not found');
  return this.adminPreview(refund.orderId,actor,cancellationReason,undefined,id);
 }

 async adminIssue(dto:AdminRefundDto,actor:{id:string;role:Role;email?:string},request?:Request, requestId?:string) {
  this.assertPlatformAdmin(actor);
  if(dto.confirmed!==true || dto.reason.trim().length<5) throw new BadRequestException('Confirmation and a meaningful reason are required');
  const preview=await this.adminPreview(dto.orderId,actor,dto.cancellationReason,dto.refundAmounts,requestId);
  if(Math.round(dto.expectedAmount*100)!==Math.round(preview.refundAmount*100)) throw new BadRequestException('Refund amount changed. Review a fresh preview.');
  const refund=await this.refundsRepository.manager.transaction(async manager=>{
   await manager.getRepository(TicketOrderEntity).createQueryBuilder('order').where('order.id = :id',{id:dto.orderId}).setLock('pessimistic_write').getOneOrFail();
   const order=await manager.findOneOrFail(TicketOrderEntity,{where:{id:dto.orderId}});
   this.ensureOrderCanBeRefunded(order,dto.cancellationReason);
   const existing=await manager.find(RefundRequestEntity,{where:{orderId:dto.orderId}});
   if(requestId && !existing.some(r=>r.id===requestId && r.status==='requested')) throw new BadRequestException('This request is no longer awaiting approval');
   if(existing.some(r=>r.id!==requestId && !['failed','declined'].includes(r.status))) throw new BadRequestException('This order already has an active or completed refund');
   const policySnapshot=adminRefundBreakdown(order,dto.cancellationReason,dto.refundAmounts);
   const amount=policySnapshot.refundAmount;
   if(Math.round(amount*100)!==Math.round(dto.expectedAmount*100)) throw new BadRequestException('Refund policy changed. Review a fresh preview.');
   if(requestId) {
    const claimed=await manager.update(RefundRequestEntity,{id:requestId,orderId:order.id,status:'requested'},{status:'processing',amount,policySnapshot,reviewNote:dto.reason.trim(),reviewedById:actor.id,reviewedAt:new Date()});
    if(!claimed.affected) throw new BadRequestException('This request is already being reviewed');
    return manager.findOneOrFail(RefundRequestEntity,{where:{id:requestId}});
   }
   return manager.save(RefundRequestEntity,manager.create(RefundRequestEntity,{order,orderId:order.id,customerEmail:order.customerEmail,reason:`Admin-initiated: ${dto.reason.trim()}`,reviewNote:dto.reason.trim(),reviewedById:actor.id,reviewedAt:new Date(),status:'processing',amount,policySnapshot,currency:order.currency}));
  });
  await this.auditService.log(requestId?'refund.approved':'refund.admin_initiated',actor,'refund_request',refund.id,{after:this.pickRefundAuditFields(refund)},{orderId:refund.orderId},request);
  return this.applyStripeRefund(refund.id,await this.createStripeRefund(refund));
 }

	async createRequest(dto: CreateRefundRequestDto) {
		const order = await this.ticketOrdersRepository.findOne({ where: { id: dto.orderId } });
		if (!order) throw new NotFoundException('Ticket order not found');
		if (order.customerEmail.toLowerCase() !== dto.customerEmail.toLowerCase().trim()) {
			throw new ForbiddenException('This email does not match the ticket order');
		}
		this.ensureOrderCanBeRefunded(order);

        const refund = await this.refundsRepository.manager.transaction(async manager => {
            await manager.getRepository(TicketOrderEntity).createQueryBuilder('order').where('order.id = :id', {id: order.id}).setLock('pessimistic_write').getOneOrFail();
            const currentOrder = await manager.findOneOrFail(TicketOrderEntity, {where: {id: order.id}});
            this.ensureOrderCanBeRefunded(currentOrder);
            const existing = await manager.find(RefundRequestEntity, {where: {orderId: order.id}});
            if (existing.some(r => !['declined','failed'].includes(r.status))) throw new BadRequestException('A refund request already exists for this order');
            return manager.save(RefundRequestEntity, manager.create(RefundRequestEntity, {
                order: currentOrder, orderId: order.id, customerEmail: order.customerEmail,
                reason: dto.reason?.trim() || null, amount: this.calculateRefundAmount(currentOrder), policySnapshot: refundBreakdown(currentOrder),
                currency: order.currency, status: 'requested',
            }));
        });

		await this.auditService.log(
			'refund.requested',
			undefined,
			'refund_request',
			refund.id,
			{ after: this.pickRefundAuditFields(refund) },
			{ orderId: order.id, customerEmail: order.customerEmail },
		);

		await this.notifyOrganizer(refund, 'requested');

		return refund;
	}

	async findAll(user: { id: string; role: Role }) {
		if (this.isAdminRole(user.role)) {
			return this.refundsRepository.find({ order: { createdAt: 'DESC' } });
		}

		return this.refundsRepository.find({
			where: { order: { organization: { ownerUserId: user.id } } },
			order: { createdAt: 'DESC' },
		});
	}

	async approve(
		id: string,
		dto: ReviewRefundRequestDto,
		actor: { id: string; email?: string; role: Role },
		request?: Request,
	) {
		const refund = await this.findOneForReview(id, actor);
		if (refund.status !== 'requested') {
			throw new BadRequestException('Only requested refunds can be approved');
		}
		this.ensureOrderCanBeRefunded(refund.order);

		this.requireStripePayment(refund.order);
		const before = this.pickRefundAuditFields(refund);
		refund.policySnapshot = refundBreakdown(refund.order);
		refund.amount = Number(refund.policySnapshot.refundAmount);
		refund.status = 'processing';
		refund.reviewedById = actor.id;
		refund.reviewedBy = await this.usersRepository.findOne({ where: { id: actor.id } });
		refund.reviewNote = dto.note?.trim() || null;
		refund.reviewedAt = new Date();
        const claimed = await this.refundsRepository.update({ id, status: 'requested' }, {
            status: 'processing', amount: refund.amount, policySnapshot: refund.policySnapshot, reviewedById: actor.id,
            reviewNote: refund.reviewNote, reviewedAt: refund.reviewedAt,
        });
        if (!claimed.affected) throw new BadRequestException('This refund is already being reviewed');
        const stripeRefund = await this.createStripeRefund(refund);
        const saved = await this.applyStripeRefund(refund.id, stripeRefund);

		await this.auditService.log(
			'refund.approved',
			actor,
			'refund_request',
			saved.id,
			this.buildChanges(before, this.pickRefundAuditFields(saved)),
			{ orderId: refund.order.id, stripeRefundId: saved.stripeRefundId },
			request,
		);
		return saved;
	}

	async decline(
		id: string,
		dto: ReviewRefundRequestDto,
		actor: { id: string; email?: string; role: Role },
		request?: Request,
	) {
		const refund = await this.findOneForReview(id, actor);
		if (refund.status !== 'requested') {
			throw new BadRequestException('Only requested refunds can be declined');
		}

		const before = this.pickRefundAuditFields(refund);
		refund.status = 'declined';
		refund.reviewedById = actor.id;
		refund.reviewedBy = await this.usersRepository.findOne({ where: { id: actor.id } });
		refund.reviewNote = dto.note?.trim() || null;
		refund.reviewedAt = new Date();
		const declined = await this.refundsRepository.update({id, status: 'requested'}, {status: 'declined', reviewedById: actor.id, reviewNote: refund.reviewNote, reviewedAt: refund.reviewedAt});
		if (!declined.affected) throw new BadRequestException('This refund is already being reviewed');
		const saved = await this.refundsRepository.findOneOrFail({where: {id}});

		await this.auditService.log(
			'refund.declined',
			actor,
			'refund_request',
			saved.id,
			this.buildChanges(before, this.pickRefundAuditFields(saved)),
			{ orderId: refund.order.id },
			request,
		);
		await this.notifyOrganizer(saved, 'declined');
		return saved;
	}

	private async findOneForReview(id: string, user: { id: string; role: Role }) {
		const refund = await this.refundsRepository.findOne({ where: { id } });
		if (!refund) throw new NotFoundException('Refund request not found');
		if (!this.isAdminRole(user.role) && refund.order.organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot review this refund');
		}
		return refund;
	}

	private ensureOrderCanBeRefunded(order: TicketOrderEntity, reason: RefundReason = 'voluntary') {
		if (order.status !== 'paid') {
			throw new BadRequestException('Only paid orders can be refunded');
		}
		refundBreakdown(order, reason);
		// Admin cancellation/error refunds are allowed after cutoff or ticket use.
		if (reason !== 'voluntary') return;
		if ((order.tickets || []).some((ticket) => ticket.status === 'checked_in')) {
			throw new BadRequestException('Checked-in tickets cannot be refunded');
		}
		if (order.event?.refundsAllowed === false) {
			throw new BadRequestException('This event does not allow buyer-requested refunds');
		}
		if (this.calculateRefundAmount(order) <= 0) {
			throw new BadRequestException('This event does not have a refundable amount available');
		}
		const cutoffHours = Number(order.event?.refundCutoffHours ?? 24);
		const eventStart = order.event?.startsAt ? new Date(order.event.startsAt) : null;
		if (eventStart) {
			const cutoff = new Date(eventStart.getTime() - cutoffHours * 60 * 60 * 1000);
			if (Date.now() > cutoff.getTime()) {
				throw new BadRequestException('Refund cutoff has passed for this event');
			}
		}
	}

 private requireStripePayment(order: TicketOrderEntity) {
  const secret = this.configService.get<string>('STRIPE_SECRET_KEY');
  if (!secret) throw new BadRequestException('Stripe is not configured. No refund has been issued.');
  if (!/^pi_[A-Za-z0-9]+$/.test(order.stripePaymentIntentId || '')) throw new BadRequestException('This order has no valid Stripe payment reference. No refund has been issued.');
  return secret;
 }

 private async createStripeRefund(refund: RefundRequestEntity, retry = false) {
  const order = refund.order;
  const secretKey = this.requireStripePayment(order);
  const params = new URLSearchParams({payment_intent: order.stripePaymentIntentId!, amount: String(Math.round(Number(refund.amount) * 100)), reverse_transfer: 'true', refund_application_fee: 'true'});
  params.set('metadata[ticketOrderId]', order.id);
  params.set('metadata[refundRequestId]', refund.id);
  // Persisted request amount and a stable key make retries safe after timeouts.
  const response = await fetch('https://api.stripe.com/v1/refunds', {
   method: 'POST', headers: {Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `venuespice-refund:${refund.id}`}, body: params,
   signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json() as StripeRefund;
  if (!response.ok) {
   // Server/network errors are ambiguous: leave processing for reconciliation.
   if (!retry && payload.error?.type !== 'idempotency_error' && response.status >= 400 && response.status < 500 && ![409,429].includes(response.status)) {
    await this.refundsRepository.manager.transaction(async manager=>{
     await manager.getRepository(RefundRequestEntity).createQueryBuilder('refund').where('refund.id = :id',{id:refund.id}).setLock('pessimistic_write').getOneOrFail();
     const current=await manager.findOneOrFail(RefundRequestEntity,{where:{id:refund.id}});
     if(current.status!=='processing') return;
     current.status='failed';current.providerPayload={error:{message:payload.error?.message || 'Stripe rejected the refund'}};
     await manager.save(RefundRequestEntity,current);await this.recordCustomerEmail(manager,current);
    });
    await this.dispatchRefundEmails();
   }
   throw new BadRequestException(payload.error?.message ?? 'Stripe refund could not be confirmed.');
  }
  return payload;
 }

 private async applyStripeRefund(id: string, provider: StripeRefund) {
  let completed = false;
  const saved = await this.refundsRepository.manager.transaction(async manager => {
   // Lock only the request row (eager joins include nullable relations).
   await manager.getRepository(RefundRequestEntity).createQueryBuilder('refund').where('refund.id = :id', {id}).setLock('pessimistic_write').getOneOrFail();
   const refund = await manager.getRepository(RefundRequestEntity).findOneOrFail({where: {id}});
   if (refund.status === 'succeeded' || refund.status === 'failed') return refund;
   if (!provider.id?.startsWith('re_') || provider.payment_intent !== refund.order.stripePaymentIntentId || provider.amount !== Math.round(Number(refund.amount)*100) || provider.currency?.toLowerCase() !== refund.currency.toLowerCase()) {
    throw new BadRequestException('Stripe refund details do not match this request. Refund remains unconfirmed.');
   }
   refund.stripeRefundId = provider.id;
   refund.providerPayload = provider as Record<string, unknown>;
   refund.status = provider.status === 'succeeded' ? 'succeeded' : ['failed','canceled'].includes(provider.status || '') ? 'failed' : 'processing';
   refund.completedAt = refund.status === 'succeeded' ? new Date() : null;
   if (refund.status === 'succeeded') {
    const components=refund.policySnapshot && 'refundComponents' in refund.policySnapshot ? refund.policySnapshot.refundComponents : null;
    if(!components || components.tickets>0) await this.markOrderRefunded(refund.order, manager);
    completed = true;
   }
   await manager.save(RefundRequestEntity, refund);
   await this.recordCustomerEmail(manager,refund);
   return refund;
  });
  await this.dispatchRefundEmails();
  if (completed) await this.notifyOrganizer(saved, 'approved');
  return saved;
 }

 private async recordCustomerEmail(manager:EntityManager, refund:RefundRequestEntity) {
  if(!['processing','succeeded','failed'].includes(refund.status)) return;
  const state=refund.status;
  const snapshot=refund.policySnapshot;
  const components=snapshot && 'refundComponents' in snapshot ? snapshot.refundComponents : null;
  const cancelsTickets=!components || components.tickets>0;
  const title=state==='processing'?'Your refund is approved and processing':state==='succeeded'?'Your refund is confirmed':'Your refund could not be completed';
  const intro=state==='processing'?'Your refund has been accepted for processing. It has not yet been confirmed as complete.':state==='succeeded'?'Stripe has confirmed your refund to the original payment method. Your bank may take additional time to display the credit.':'The payment provider could not complete your refund. Our team needs to review it; no successful refund has been confirmed.';
  const rows=[{label:'Event',value:refund.order.event.title},{label:'Order',value:refund.orderId},{label:'Refund amount',value:this.formatCurrency(Number(refund.amount),refund.currency)},
   {label:'Tickets',value:state==='succeeded'?(cancelsTickets?'All tickets in this order are canceled':'Tickets remain valid'):cancelsTickets?'Tickets remain unchanged until refund success':'Tickets remain valid'},
   {label:'Refund reference',value:refund.stripeRefundId || refund.id}];
  if(snapshot) {
   rows.push({label:'Ticket / add-on portion',value:this.formatCurrency(snapshot.refundedSubtotal,refund.currency)},
    {label:'Fee portion',value:this.formatCurrency(snapshot.refundedFees,refund.currency)},
    {label:'Tax portion',value:this.formatCurrency(snapshot.taxPortion,refund.currency)},
    {label:'Amount retained',value:this.formatCurrency(snapshot.totalRetained,refund.currency)});
   rows.push({label:'Processing fee retained',value:this.formatCurrency(snapshot.retainedProcessingFee,refund.currency)});
   if(components && 'availableComponents' in snapshot) rows.push({label:'Service fee retained',value:this.formatCurrency(snapshot.availableComponents.serviceFee-components.serviceFee,refund.currency)});
   if(components) rows.push({label:'Service fee portion',value:this.formatCurrency(components.serviceFee,refund.currency)},{label:'Processing fee portion',value:this.formatCurrency(components.processingFee,refund.currency)});
  }
  const html=this.notificationsService.buildBrandedEmail({title,intro,greeting:`Hello ${refund.order.customerName || 'there'},`,rows});
  await manager.createQueryBuilder().insert().into(RefundEmailEntity).values({id:`refund-${refund.id}-${state}-buyer`,recipient:refund.customerEmail,subject:title,html}).orIgnore().execute();
  if(state==='failed') {
   const reviewer=refund.reviewedById?await manager.findOne(UserEntity,{where:{id:refund.reviewedById}}):null;
   if(reviewer?.email) await manager.createQueryBuilder().insert().into(RefundEmailEntity).values({id:`refund-${refund.id}-${state}-admin`,recipient:reviewer.email,subject:`Refund needs attention: ${refund.orderId}`,html:this.notificationsService.buildBrandedEmail({title:'Refund needs attention',intro:'The provider rejected or failed this refund. Review the provider record before taking further action.',rows})}).orIgnore().execute();
  }
 }

 @Cron('*/1 * * * *')
 async dispatchRefundEmails() {
  try {
   const pending=await this.refundsRepository.manager.find(RefundEmailEntity,{where:{queuedAt:IsNull()},order:{createdAt:'ASC'},take:100});
   for(const item of pending) {
    await this.refundsRepository.manager.transaction(async manager=>{
     const row=await manager.getRepository(RefundEmailEntity).createQueryBuilder('email').where('email.id = :id',{id:item.id}).setLock('pessimistic_write').getOne();
     if(!row || row.queuedAt) return;
     await this.notificationsService.queueEmail(row.recipient,row.subject,row.html,{jobId:row.id,removeOnComplete:false,removeOnFail:false});
     row.queuedAt=new Date();await manager.save(RefundEmailEntity,row);
    });
   }
  } catch { this.logger.warn('Refund emails remain in the outbox for retry; refund status was not changed.'); }
 }

 @Cron('*/1 * * * *')
 async reconcileProcessingRefunds() {
  if (this.reconciling) return;
  this.reconciling = true;
  try {
   const refunds = await this.refundsRepository.find({where: {status: 'processing'}, order: {updatedAt: 'ASC'}, take: 100});
   for (const refund of refunds) {
    try {
     const secret = this.requireStripePayment(refund.order);
     let provider: StripeRefund;
     if (refund.stripeRefundId) {
      const response = await fetch(`https://api.stripe.com/v1/refunds/${encodeURIComponent(refund.stripeRefundId)}`, {headers: {Authorization: `Bearer ${secret}`}, signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('Stripe refund status unavailable');
      provider = await response.json() as StripeRefund;
     } else {
      // Never repeat a creation after Stripe's minimum 24-hour idempotency window.
      if (!refund.reviewedAt || Date.now()-new Date(refund.reviewedAt).getTime() >= 23*60*60*1000) {
       this.logger.warn(`Refund ${refund.id} needs manual Stripe reconciliation; no new refund was issued.`);
       await this.refundsRepository.update({id: refund.id, status: 'processing'}, {updatedAt: new Date()});
       continue;
      }
      provider = await this.createStripeRefund(refund, true);
     }
     await this.applyStripeRefund(refund.id, provider);
    } catch {
     this.logger.warn(`Refund ${refund.id} could not be reconciled; no success was recorded.`);
     await this.refundsRepository.update({id: refund.id, status: 'processing'}, {updatedAt: new Date()});
    }
   }
  } finally { this.reconciling = false; }
 }

	private calculateRefundAmount(order: TicketOrderEntity) {
		return refundBreakdown(order).refundAmount;
	}

	private async notifyOrganizer(refund: RefundRequestEntity, state: 'requested' | 'approved' | 'declined') {
		const organization = refund.order?.organization;
		const ownerUserId = organization?.ownerUserId;
		const owner = ownerUserId ? await this.usersRepository.findOne({ where: { id: ownerUserId } }) : null;
		const recipientEmail = owner?.email || organization?.contactEmail || organization?.businessEmail;
		const eventTitle = refund.order?.event?.title || 'your event';
		const amount = this.formatCurrency(Number(refund.amount || 0), refund.currency);
		const dashboardUrl = this.buildDashboardUrl('/dashboard/sales');
		const config = {
			requested: {
				type: 'refund.requested',
				subject: `Refund request received for ${eventTitle}`,
				title: 'Refund request received',
				message: `${refund.customerEmail} requested a ${amount} refund for ${eventTitle}.`,
				intro: 'A buyer submitted a refund request. Review it against the event policy, ticket status, and order details before a decision is made.',
			},
			approved: {
				type: 'refund.approved',
				subject: `Refund approved for ${eventTitle}`,
				title: 'Refund approved',
				message: `${amount} was refunded to ${refund.customerEmail} for ${eventTitle}.`,
				intro: 'Stripe has confirmed the refund. Ticket cancellations apply only when ticket charges were refunded.',
			},
			declined: {
				type: 'refund.declined',
				subject: `Refund declined for ${eventTitle}`,
				title: 'Refund declined',
				message: `Refund request from ${refund.customerEmail} for ${eventTitle} was declined.`,
				intro: 'A refund request has been declined. The order remains active unless another review action is taken.',
			},
		}[state];

		if (ownerUserId) {
			await this.notificationsService.createInAppNotification({
				userId: ownerUserId,
				type: config.type,
				title: config.title,
				message: config.message,
				actionUrl: '/dashboard/sales',
				metadata: {
					refundRequestId: refund.id,
					orderId: refund.orderId,
					eventId: refund.order?.event?.id,
					amount: Number(refund.amount || 0),
					currency: refund.currency,
					status: refund.status,
				},
			});
		}

		if (!recipientEmail) return;
		await this.notificationsService.queueEmail(
			recipientEmail,
			config.subject,
			this.notificationsService.buildBrandedEmail({
				eyebrow: 'Refund update',
				title: config.title,
				greeting: `Hello ${organization?.name || 'there'},`,
				intro: config.intro,
				rows: [
					{ label: 'Event', value: eventTitle },
					{ label: 'Order', value: refund.orderId },
					{ label: 'Buyer', value: refund.customerEmail },
					{ label: 'Amount', value: amount },
					{ label: 'Status', value: refund.status },
				],
				action: dashboardUrl ? { label: 'Open sales dashboard', url: dashboardUrl } : undefined,
				note: refund.reason ? `Buyer reason: ${refund.reason}` : undefined,
			}),
		);
	}

	private buildDashboardUrl(path: string) {
		const base = this.configService.get<string>('FRONTEND_URL', '').replace(/\/$/, '');
		return base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : path;
	}

	private formatCurrency(value: number, currency = 'USD') {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: currency || 'USD',
		}).format(Number(value || 0));
	}

	private async markOrderRefunded(order: TicketOrderEntity, manager: EntityManager) {
		order.status = 'refunded';
		for (const ticket of order.tickets || []) {
			ticket.status = 'refunded';
			await manager.save(IssuedTicketEntity, ticket);
		}
		for (const item of order.items || []) {
			if (item.ticketType) {
				item.ticketType.quantitySold = Math.max(0, Number(item.ticketType.quantitySold || 0) - item.quantity);
				if (item.ticketType.status === 'sold_out') {
					item.ticketType.status = 'active';
				}
				await manager.save(TicketTypeEntity, item.ticketType);
			}
		}
		await this.markInvoiceAndTransactionRefunded(order, manager);
		return manager.save(TicketOrderEntity, order);
	}

	private async markInvoiceAndTransactionRefunded(order: TicketOrderEntity, manager: EntityManager) {
		const idempotencyKey = `ticket-order:${order.id}`;
		const transaction = await manager.getRepository(PaymentIntentEntity).findOne({
			where: { idempotencyKey },
			relations: { invoice: true },
		});
		if (transaction) {
			transaction.status = 'refunded';
			transaction.providerStatus = 'refunded';
			transaction.providerPayload = {
				...(transaction.providerPayload ?? {}),
				refundedAt: new Date().toISOString(),
				reverseTransfer: true,
				refundApplicationFee: true,
			};
			await manager.save(PaymentIntentEntity, transaction);
		}

		if (transaction?.invoice) {
			transaction.invoice.status = 'refunded';
			await manager.save(InvoiceEntity, transaction.invoice);
		}
	}

	private isAdminRole(role: Role) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN].includes(role);
	}

	private pickRefundAuditFields(refund: RefundRequestEntity) {
		return {
			status: refund.status,
			amount: Number(refund.amount || 0),
			currency: refund.currency,
			reason: refund.reason,
			policySnapshot: refund.policySnapshot,
			reviewNote: refund.reviewNote,
			stripeRefundId: refund.stripeRefundId,
			completedAt: refund.completedAt,
		};
	}

	private buildChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
		const changes: Record<string, { before: unknown; after: unknown }> = {};
		Object.keys(after).forEach((key) => {
			if (before[key] !== after[key]) {
				changes[key] = { before: before[key], after: after[key] };
			}
		});
		return changes;
	}
}
