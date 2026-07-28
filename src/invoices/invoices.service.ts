import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvoiceEntity } from './entities/invoice.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class InvoicesService {
	constructor(
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		private readonly notificationsService: NotificationsService,
	) {}

	findAll() {
		return this.invoicesRepository.find({
			relations: { user: true, order: true, serviceBooking: true, items: true },
			order: { createdAt: 'DESC' },
		});
	}

	findByUser(userId: string) {
		return this.invoicesRepository.find({
			where: { user: { id: userId } },
			relations: { user: true, order: true, serviceBooking: true, items: true },
			order: { createdAt: 'DESC' },
		});
	}

	async resendInvoice(invoiceId: string, overrideEmail?: string) {
		const invoice = await this.invoicesRepository.findOne({
			where: { id: invoiceId },
			relations: { user: true, order: true, serviceBooking: true, items: true },
		});

		if (!invoice) {
			throw new NotFoundException('Invoice not found');
		}

		const recipient =
			overrideEmail?.trim().toLowerCase() || invoice.user?.email;

		if (!recipient) {
			throw new NotFoundException('No customer email found for invoice');
		}

		await this.notificationsService.queueEmail(
			recipient,
			'Aquzera invoice ' + invoice.invoiceNumber,
			this.notificationsService.buildInvoiceEmail(
				invoice.user?.fullName ?? 'Customer',
				invoice.invoiceNumber,
				Number(invoice.total ?? 0),
				invoice.issuedAt instanceof Date
					? invoice.issuedAt.toISOString()
					: String(invoice.issuedAt ?? ''),
			),
		);

		invoice.lastSentAt = new Date();
		invoice.lastSentTo = recipient;
		invoice.sendCount = Number(invoice.sendCount ?? 0) + 1;
		await this.invoicesRepository.save(invoice);

		return {
			message: 'Invoice email queued successfully',
			invoiceId: invoice.id,
			invoiceNumber: invoice.invoiceNumber,
			sentTo: recipient,
			sendCount: invoice.sendCount,
			lastSentAt: invoice.lastSentAt,
		};
	}
}
