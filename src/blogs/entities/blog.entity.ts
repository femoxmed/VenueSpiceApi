import {
	Column,
	CreateDateColumn,
Entity,
	JoinColumn,
	JoinTable,
	ManyToMany,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { ProductEntity } from '../../products/entities/product.entity';
import { Upload } from '../../uploads/entities/upload.entity';

@Entity('blogs')
export class BlogEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column()
	title: string;

	@Column({ unique: true })
	slug: string;

	@Column({ type: 'text' })
	excerpt: string;

	@Column({ type: 'text' })
	content: string;

	@Column({ default: 'Insights' })
	category: string;

	@Column({ type: 'varchar', default: 'draft' })
	status: 'draft' | 'published' | 'archived';

	@Column({ type: 'timestamptz', nullable: true })
	publishedAt: Date | null;

	@Column({ type: 'timestamptz', nullable: true })
	featuredAt: Date | null;

	@Column({ default: 1 })
	readTimeMinutes: number;

	@ManyToOne(() => UserEntity, { nullable: false })
	@JoinColumn({ name: 'author_id' })
	author: UserEntity;

	@Column({ name: 'author_id' })
	authorId: string;

	@ManyToOne(() => Upload, { nullable: true, cascade: true })
	@JoinColumn()
	bannerImage: Upload | null;

	@ManyToOne(() => Upload, { nullable: true, cascade: true })
	@JoinColumn()
	thumbnailImage: Upload | null;

	@ManyToMany(() => ProductEntity)
	@JoinTable({ name: 'blog_related_products' })
	relatedProducts: ProductEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
