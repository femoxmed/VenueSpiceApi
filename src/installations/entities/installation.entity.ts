import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { ProductEntity } from '../../products/entities/product.entity';

@Entity('installations')
export class InstallationEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => UserEntity, (user) => user.installations, {
		eager: true,
		onDelete: 'CASCADE',
	})
	customer: UserEntity;

	@ManyToOne(() => ProductEntity, (product) => product.installations, {
		eager: true,
		onDelete: 'RESTRICT',
	})
	product: ProductEntity;

	@Column({ name: 'installation_date', type: 'date' })
	installationDate: string;

	@Column({ name: 'next_service_date', type: 'date' })
	nextServiceDate: string;

	@Column({ name: 'next_filter_change_date', type: 'date' })
	nextFilterChangeDate: string;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
