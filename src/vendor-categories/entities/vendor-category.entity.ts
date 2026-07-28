import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('vendor_categories')
export class VendorCategoryEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ unique: true })
	slug: string;

	@Column()
	label: string;

	@Column({ name: 'search_terms', type: 'text', array: true, default: '{}' })
	searchTerms: string[];

	@Column({ name: 'icon_key', type: 'varchar', nullable: true })
	iconKey?: string | null;

	@Column({ name: 'sort_order', type: 'int', default: 0 })
	sortOrder: number;

	@Column({ name: 'is_active', default: true })
	isActive: boolean;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
