import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { SupportTicketEntity } from '../support-tickets/entities/support-ticket.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { ServiceTypeEntity } from '../service-types/entities/service-type.entity';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class AdminService {
	constructor(
		@InjectRepository(UserEntity)
		private readonly customersRepository: Repository<UserEntity>,
		@InjectRepository(OrderEntity)
		private readonly ordersRepository: Repository<OrderEntity>,
		@InjectRepository(OrderItemEntity)
		private readonly orderItemsRepository: Repository<OrderItemEntity>,
		@InjectRepository(ServiceBookingEntity)
		private readonly serviceBookingsRepository: Repository<ServiceBookingEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(SupportTicketEntity)
		private readonly supportTicketsRepository: Repository<SupportTicketEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(ServiceTypeEntity)
		private readonly serviceTypesRepository: Repository<ServiceTypeEntity>,
	) {}

	async getMetrics() {
		const [
			customerCount,
			activeCustomerCount,
			orderCount,
			pendingServiceCount,
			openSupportTickets,
			invoices,
			technicianCount,
			serviceTypeCount,
		] = await Promise.all([
			this.customersRepository.count(),
			this.customersRepository.count({
				where: {
					role: In([Role.USER, Role.CUSTOMER]),
					isActive: true,
				},
			}),
			this.ordersRepository.count(),
			this.serviceBookingsRepository.count({ where: { status: 'assigned' } }),
			this.supportTicketsRepository.count({ where: { status: 'open' } }),
			this.invoicesRepository.find(),
			this.usersRepository.count({ where: { role: Role.TECHNICIAN } }),
			this.serviceTypesRepository.count({ where: { isActive: true } }),
		]);

		const monthlyRevenue = invoices.reduce(
			(sum, invoice) => sum + Number(invoice.total ?? 0),
			0,
		);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const inThirtyDays = new Date(today);
		inThirtyDays.setDate(inThirtyDays.getDate() + 30);
		const todayString = today.toISOString().slice(0, 10);
		const thirtyDaysString = inThirtyDays.toISOString().slice(0, 10);

		// Calculate revenue per month
		const monthlyRevenueData = [];
		const months = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];

		for (let i = 0; i < months.length; i++) {
			const targetMonth = new Date();
			targetMonth.setMonth(targetMonth.getMonth() - (5 - i));

			const monthInvoices = invoices.filter((inv) => {
				const invDate = new Date(inv.createdAt);
				return (
					invDate.getMonth() === targetMonth.getMonth() &&
					invDate.getFullYear() === targetMonth.getFullYear()
				);
			});

			monthlyRevenueData.push({
				month: months[i],
				revenue: monthInvoices.reduce(
					(sum, inv) => sum + Number(inv.total ?? 0),
					0,
				),
			});
		}

		// Calculate invoice status breakdown
		const paidCount = invoices.filter((i) => i.status === 'paid').length;
		const pendingCount = invoices.filter((i) => i.status === 'pending').length;
		const overdueCount = invoices.filter((i) => i.status === 'overdue').length;

		const invoiceStatusData = [
			{ name: 'Paid', value: paidCount, color: '#10b981' },
			{ name: 'Pending', value: pendingCount, color: '#f59e0b' },
			{ name: 'Overdue', value: overdueCount, color: '#ef4444' },
		];

		// Calculate order and service counts per month
		const [allOrders, allServices] = await Promise.all([
			this.ordersRepository.find(),
			this.serviceBookingsRepository.find(),
		]);

		const orderServiceData = months.map((month, i) => {
			const targetMonth = new Date();
			targetMonth.setMonth(targetMonth.getMonth() - (5 - i));

			const monthOrders = allOrders.filter((order) => {
				const ordDate = new Date(order.createdAt);
				return (
					ordDate.getMonth() === targetMonth.getMonth() &&
					ordDate.getFullYear() === targetMonth.getFullYear()
				);
			});

			const monthServices = allServices.filter((service) => {
				const srvDate = new Date(service.createdAt);
				return (
					srvDate.getMonth() === targetMonth.getMonth() &&
					srvDate.getFullYear() === targetMonth.getFullYear()
				);
			});

			return {
				month,
				orders: monthOrders.length,
				services: monthServices.length,
			};
		});

		// Calculate service type volume
		const serviceTypes = await this.serviceTypesRepository.find();
		const serviceCounts = await this.serviceBookingsRepository
			.createQueryBuilder('booking')
			.select('booking.serviceTypeId', 'serviceTypeId')
			.addSelect('COUNT(*)', 'count')
			.groupBy('booking.serviceTypeId')
			.getRawMany();

		const serviceTypeData = serviceTypes
			.map((type) => {
				const countEntry = serviceCounts.find(
					(c) => c.serviceTypeId === type.id,
				);
				return {
					name: type.name,
					count: countEntry ? Number(countEntry.count) : 0,
				};
			})
			.sort((a, b) => b.count - a.count);

		const [upcomingFilterChanges, overdueServices] = await Promise.all([
			this.orderItemsRepository.count({
				where: {
					maintenanceRequired: true,
					nextMaintenanceDate: MoreThanOrEqual(todayString),
				},
			}),
			this.orderItemsRepository.count({
				where: {
					maintenanceRequired: true,
					nextMaintenanceDate: LessThan(todayString),
				},
			}),
		]);

		const upcomingFilterChanges30Days = await this.orderItemsRepository
			.createQueryBuilder('item')
			.where('item.maintenanceRequired = :required', { required: true })
			.andWhere('item.nextMaintenanceDate >= :today', { today: todayString })
			.andWhere('item.nextMaintenanceDate <= :thirtyDays', {
				thirtyDays: thirtyDaysString,
			})
			.getCount();

		const topSellingProducts = await this.orderItemsRepository
			.createQueryBuilder('item')
			.leftJoin('item.product', 'product')
			.select('product.id', 'productId')
			.addSelect('product.name', 'name')
			.addSelect('SUM(item.qty)', 'unitsSold')
			.addSelect('SUM(item.qty * item.unitPrice)', 'revenue')
			.groupBy('product.id')
			.addGroupBy('product.name')
			.orderBy('SUM(item.qty)', 'DESC')
			.limit(5)
			.getRawMany()
			.then((rows) =>
				rows.map((row) => ({
					productId: row.productId,
					name: row.name || 'Unknown product',
					unitsSold: Number(row.unitsSold || 0),
					revenue: Number(row.revenue || 0),
				})),
			);

		const technicianPerformance = await this.serviceBookingsRepository
			.createQueryBuilder('booking')
			.leftJoin('booking.technician', 'technician')
			.select('technician.id', 'technicianId')
			.addSelect('technician.fullName', 'technicianName')
			.addSelect('COUNT(booking.id)', 'assignedJobs')
			.addSelect(
				"SUM(CASE WHEN booking.status IN ('completed', 'done', 'closed') THEN 1 ELSE 0 END)",
				'completedJobs',
			)
			.addSelect(
				"SUM(CASE WHEN booking.preferredDate < :today AND booking.status NOT IN ('completed', 'done', 'closed', 'cancelled') THEN 1 ELSE 0 END)",
				'overdueJobs',
			)
			.where('technician.id IS NOT NULL')
			.setParameter('today', todayString)
			.groupBy('technician.id')
			.addGroupBy('technician.fullName')
			.orderBy('COUNT(booking.id)', 'DESC')
			.limit(5)
			.getRawMany()
			.then((rows) =>
				rows.map((row) => {
					const assignedJobs = Number(row.assignedJobs || 0);
					const completedJobs = Number(row.completedJobs || 0);
					return {
						technicianId: row.technicianId,
						technicianName: row.technicianName || 'Unassigned',
						assignedJobs,
						completedJobs,
						overdueJobs: Number(row.overdueJobs || 0),
						completionRate: assignedJobs
							? Math.round((completedJobs / assignedJobs) * 100)
							: 0,
					};
				}),
			);

		const averageFilterRevenue =
			topSellingProducts.length > 0
				? topSellingProducts.reduce((sum, item) => sum + item.revenue, 0) /
					topSellingProducts.reduce((sum, item) => sum + item.unitsSold, 0)
				: 0;
		const recurringRevenueForecast = Math.round(
			upcomingFilterChanges30Days * averageFilterRevenue,
		);

		return {
			customerCount,
			activeCustomerCount,
			orderCount,
			pendingServiceCount,
			upcomingFilterChanges,
			upcomingFilterChanges30Days,
			overdueServices,
			monthlyRevenue,
			openSupportTickets,
			invoiceCount: invoices.length,
			technicianCount,
			serviceTypeCount,
			recurringRevenueForecast,
			topSellingProducts,
			technicianPerformance,
			// Chart datasets
			monthlyRevenueData,
			invoiceStatusData,
			orderServiceData,
			serviceTypeData,
		};
	}
}
