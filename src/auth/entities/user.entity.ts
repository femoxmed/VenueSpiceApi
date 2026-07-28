import {
	Column,
	CreateDateColumn,
	Entity,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { OrderEntity } from '../../orders/entities/order.entity';
import { InstallationEntity } from '../../installations/entities/installation.entity';
import { ServiceBookingEntity } from '../../service-bookings/entities/service-booking.entity';
import { CrmRecordEntity } from '../../crm/entities/crm-record.entity';

@Entity('users')
export class UserEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'full_name' })
	fullName: string;

	@Column({ unique: true })
	email: string;

	@Column({ name: 'password_hash' })
	passwordHash: string;

	@Column({ type: 'enum', enum: Role, default: Role.USER })
	role: Role;

	@Column({ default: true })
	isActive: boolean;

	@Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
	verifiedAt?: Date | null;

	@Column({ name: 'email_verification_code_hash', type: 'text', nullable: true })
	emailVerificationCodeHash?: string | null;

	@Column({
		name: 'email_verification_expires_at',
		type: 'timestamptz',
		nullable: true,
	})
	emailVerificationExpiresAt?: Date | null;

	@Column({ name: 'admin_otp_code_hash', type: 'text', nullable: true })
	adminOtpCodeHash?: string | null;

	@Column({
		name: 'admin_otp_expires_at',
		type: 'timestamptz',
		nullable: true,
	})
	adminOtpExpiresAt?: Date | null;

	@Column({ name: 'active_at', type: 'timestamptz', nullable: true })
	activeAt?: Date | null;

	@Column({ type: 'varchar', nullable: true })
	phone?: string | null;

	@Column({ name: 'account_type', type: 'varchar', nullable: true })
	accountType?: string | null;

	@Column({ name: 'business_name', type: 'varchar', nullable: true })
	businessName?: string | null;

	@Column({ name: 'business_category', type: 'varchar', nullable: true })
	businessCategory?: string | null;

	@Column({ type: 'varchar', nullable: true })
	country?: string | null;

	@Column({ name: 'postal_code', type: 'varchar', nullable: true })
	postalCode?: string | null;

	@Column({ name: 'subscription_plan', type: 'varchar', nullable: true })
	subscriptionPlan?: string;

	@Column({ name: 'installed_products', default: 0 })
	installedProducts: number;

	@OneToMany(() => OrderEntity, (order) => order.user)
	orders: OrderEntity[];

	@OneToMany(() => InstallationEntity, (installation) => installation.customer)
	installations: InstallationEntity[];

	@OneToMany(
		() => ServiceBookingEntity,
		(serviceBooking) => serviceBooking.user,
	)
	serviceBookings: ServiceBookingEntity[];

	@OneToMany(() => CrmRecordEntity, (crmRecord) => crmRecord.customer)
	crmRecords: CrmRecordEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
