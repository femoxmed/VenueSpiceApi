import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';

@Entity('vendor_catalogue_items')
export class VendorCatalogueItemEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => OrganizationEntity, { eager: true, onDelete: 'CASCADE' })
	organization: OrganizationEntity;

	@Column({ name: 'organization_id', type: 'uuid' })
	organizationId: string;

	@Column()
	name: string;

	@Column({ name: 'image_url', type: 'text', nullable: true })
	imageUrl?: string | null;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	price: number;

	@Column({ name: 'price_type', type: 'varchar', default: 'fixed' })
	priceType: 'fixed' | 'range';

	@Column({ name: 'min_price', type: 'decimal', precision: 12, scale: 2, nullable: true })
	minPrice?: number | null;

	@Column({ name: 'max_price', type: 'decimal', precision: 12, scale: 2, nullable: true })
	maxPrice?: number | null;

	@Column({ name: 'unit_measure', type: 'varchar' })
	unitMeasure: string;

	@Column({ name: 'minimum_order_quantity', type: 'int', default: 1 })
	minimumOrderQuantity: number;

	@Column({ type: 'text', nullable: true })
	description?: string | null;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'archived';

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
