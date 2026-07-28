import {
	Column,
	CreateDateColumn,
	Entity,
	OneToMany,
	ManyToOne,
	ManyToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
	AfterLoad,
	JoinColumn,
	JoinTable,
} from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import { InstallationEntity } from '../../installations/entities/installation.entity';
import { Upload } from '../../uploads/entities/upload.entity';

export type ProductColorVariation = {
	id: string;
	label: string;
	value: string;
	image?: Upload;
	imageUrl?: string;
};

export type ProductFeature = {
	title: string;
	titleLine2?: string;
	description: string;
	image?: Upload;
	imageUrl: string;
	imageAlt?: string;
	imageClassName?: string;
};

export type ProductSpecification = {
	label: string;
	value: string;
};

export type ProductBoxItem = {
	title: string;
	image?: Upload;
	imageUrl: string;
	description?: string;
	imageAlt?: string;
};

export type ProductAddOn = {
	productId: string;
	isCompulsory?: boolean;
};

@Entity('products')
export class ProductEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column()
	name: string;

	@Column({ unique: true, nullable: true })
	slug: string;

	@Column({ unique: true })
	sku: string;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	price: number;

	@Column({ default: 0 })
	stock: number;

	@Column({ type: 'text', nullable: true })
	shortDescription: string | null;

	@Column({ type: 'text', nullable: true })
	description: string | null;

	@Column({ type: 'text', nullable: true })
	startingPriceLabel: string | null;

	@Column({ type: 'jsonb', nullable: true })
	colors: ProductColorVariation[] | null;

	@Column({ type: 'jsonb', nullable: true })
	features: ProductFeature[] | null;

	@Column({ type: 'jsonb', nullable: true })
	specifications: ProductSpecification[] | null;

	@Column({ type: 'jsonb', nullable: true })
	boxItems: ProductBoxItem[] | null;

	@Column({ type: 'jsonb', nullable: true })
	addOns: ProductAddOn[] | null;

	@Column({ type: 'varchar', default: 'draft' })
	status: 'draft' | 'active' | 'archived';

	@Column({ type: 'timestamptz', nullable: true })
	featuredAt: Date | null;

	@Column({ default: 0 })
	sortOrder: number;

	@ManyToOne(() => Upload, { nullable: true, cascade: true })
	@JoinColumn()
	bannerImage: Upload | null;

	@ManyToOne(() => Upload, { nullable: true, cascade: true })
	@JoinColumn()
	mainImage: Upload | null;

	@ManyToMany(() => Upload, { cascade: true })
	@JoinTable()
	galleryImages: Upload[];

	@OneToMany(() => OrderItemEntity, (item) => item.product)
	orderItems: OrderItemEntity[];

	@OneToMany(() => InstallationEntity, (installation) => installation.product)
	installations: InstallationEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;

	@AfterLoad()
	convertImageKeysToUrls() {
		const configService = new ConfigService();
		const baseUrl = configService.get<string>(
			'APP_URL',
			'http://localhost:4000',
		);

		// Populate url and path on upload objects
		if (this.bannerImage) {
			if (!this.bannerImage.url) {
				this.bannerImage.url = `${baseUrl}/uploads/${this.bannerImage.key}`;
			}
			if (!this.bannerImage.path) {
				this.bannerImage.path = `/uploads/${this.bannerImage.key}`;
			}
		}

		if (this.mainImage) {
			if (!this.mainImage.url) {
				this.mainImage.url = `${baseUrl}/uploads/${this.mainImage.key}`;
			}
			if (!this.mainImage.path) {
				this.mainImage.path = `/uploads/${this.mainImage.key}`;
			}
		}

		if (this.galleryImages && Array.isArray(this.galleryImages)) {
			this.galleryImages.forEach((image) => {
				if (image && !image.url) {
					image.url = `${baseUrl}/uploads/${image.key}`;
				}
				if (image && !image.path) {
					image.path = `/uploads/${image.key}`;
				}
			});
		}
	}
}
