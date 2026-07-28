import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';

@Entity('crm_records')
export class CrmRecordEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => UserEntity, (user) => user.crmRecords, {
		eager: true,
		onDelete: 'CASCADE',
	})
	customer: UserEntity;

	@Column()
	type: string;

	@Column()
	channel: string;

	@Column({ type: 'text' })
	summary: string;

	@Column()
	status: string;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
