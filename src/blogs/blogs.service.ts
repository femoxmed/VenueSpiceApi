import { BadRequestException, ForbiddenException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, IsNull, Not, Repository } from 'typeorm';
import { BlogEntity } from './entities/blog.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { UploadsService } from '../uploads/uploads.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class BlogsService implements OnModuleDestroy {
	private readonly redis: Redis;
	private readonly appUrl: string;

	constructor(
		@InjectRepository(BlogEntity) private readonly blogs: Repository<BlogEntity>,
		@InjectRepository(ProductEntity) private readonly products: Repository<ProductEntity>,
		private readonly uploads: UploadsService,
		config: ConfigService,
	) {
		this.appUrl = config.get('APP_URL', 'http://localhost:4000').replace(/\/$/, '');
		this.redis = new Redis({
			host: config.get('REDIS_HOST', '127.0.0.1'),
			port: config.get('REDIS_PORT', 6379),
			db: config.get('REDIS_DB', 0),
			tls: config.get('REDIS_TLS', 'false') === 'true' ? {} : undefined,
			lazyConnect: true,
			maxRetriesPerRequest: 1,
		});
	}

	async onModuleDestroy() {
		await this.redis.quit().catch(() => undefined);
	}

	findAll() {
		return this.blogs.find({
			order: { createdAt: 'DESC' },
			relations: ['author', 'bannerImage', 'thumbnailImage', 'relatedProducts'],
		});
	}

	async publicList(page = 1, limit = 12) {
		const currentPage = Math.max(1, page || 1);
		const pageSize = Math.min(36, Math.max(1, limit || 12));
		const [items, total] = await this.blogs.findAndCount({
			where: { status: 'published' },
			order: { publishedAt: 'DESC', createdAt: 'DESC' },
			relations: ['author', 'thumbnailImage'],
			skip: (currentPage - 1) * pageSize,
			take: pageSize,
		});
		return { blogs: await this.withViews(items), pagination: {
			page: currentPage, limit: pageSize, total,
			totalPages: Math.max(1, Math.ceil(total / pageSize)),
		}};
	}

	async featured(limit = 12) {
		const items = await this.blogs.find({
			where: { status: 'published', featuredAt: Not(IsNull()) },
			order: { featuredAt: 'DESC', publishedAt: 'DESC' },
			relations: ['author', 'thumbnailImage'],
			take: Math.min(12, Math.max(1, limit || 12)),
		});
		return this.withViews(items);
	}

	async publicOne(slug: string) {
		const blog = await this.blogs.findOne({
			where: { slug, status: 'published' },
			relations: [
				'author',
				'bannerImage',
				'thumbnailImage',
				'relatedProducts',
				'relatedProducts.mainImage',
				'relatedProducts.bannerImage',
				'relatedProducts.galleryImages',
			],
		});
		if (!blog) throw new BadRequestException('Blog not found');
		blog.relatedProducts?.forEach((product) => {
			this.normalizeUploadUrl(product.mainImage);
			this.normalizeUploadUrl(product.bannerImage);
			product.galleryImages?.forEach((image) => this.normalizeUploadUrl(image));
		});
		return (await this.withViews([blog]))[0];
	}

	async recordView(slug: string) {
		const blog = await this.blogs.findOneBy({ slug, status: 'published' });
		if (!blog) throw new BadRequestException('Blog not found');
		try {
			const views = await this.redis.incr(this.viewKey(blog.id));
			return { views };
		} catch {
			return { views: 0 };
		}
	}

	async create(dto: CreateBlogDto, authorId: string, files: any) {
		const normalized = await this.normalize(dto);
		const blog = this.blogs.create({ ...normalized, authorId });
		await this.attachFiles(blog, files);
		return this.blogs.save(blog);
	}

	async update(id: string, dto: CreateBlogDto, user: any, files: any) {
		const blog = await this.blogs.findOne({ where: { id }, relations: ['relatedProducts'] });
		if (!blog) throw new BadRequestException('Blog not found');
		this.assertOwnership(blog, user);
		Object.assign(blog, await this.normalize(dto, id));
		await this.attachFiles(blog, files);
		return this.blogs.save(blog);
	}

	async remove(id: string, user: any) {
		const blog = await this.blogs.findOneBy({ id });
		if (!blog) throw new BadRequestException('Blog not found');
		this.assertOwnership(blog, user);
		await this.blogs.remove(blog);
		return { deleted: true, id };
	}

	private async normalize(dto: CreateBlogDto, id?: string) {
		const slug = this.slugify(dto.slug || dto.title);
		const existing = await this.blogs.findOneBy({ slug });
		if (existing && existing.id !== id) throw new BadRequestException('Blog slug already exists');
		const relatedIds = this.parseIds(dto.relatedProductIds);
		const relatedProducts = relatedIds.length ? await this.products.findBy({ id: In(relatedIds) }) : [];
		const status = dto.status || 'draft';
		return {
			title: dto.title.trim(), slug, excerpt: dto.excerpt.trim(), content: dto.content.trim(),
			category: dto.category?.trim() || 'Insights', status,
			publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : status === 'published' ? new Date() : null,
			featuredAt: dto.featuredAt ? new Date(dto.featuredAt) : null,
			readTimeMinutes: Math.max(1, Math.ceil(this.wordCount(dto.content) / 220)),
			relatedProducts,
		};
	}

	private async attachFiles(blog: BlogEntity, files: any) {
		if (files?.bannerImage?.[0]) blog.bannerImage = await this.uploads.processUpload(files.bannerImage[0]);
		if (files?.thumbnailImage?.[0]) blog.thumbnailImage = await this.uploads.processUpload(files.thumbnailImage[0]);
	}

	private assertOwnership(blog: BlogEntity, user: any) {
		if (user.role === Role.WRITER && blog.authorId !== user.id) {
			throw new ForbiddenException('Writers can only manage their own blogs');
		}
	}

	private parseIds(value: unknown): string[] {
		if (Array.isArray(value)) return value;
		if (typeof value !== 'string' || !value) return [];
		try { return JSON.parse(value); } catch { return value.split(',').filter(Boolean); }
	}

	private wordCount(content: string) {
		return content.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
	}

	private slugify(value: string) {
		return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
	}

	private viewKey(id: string) { return `blog:views:${id}`; }

	private normalizeUploadUrl(upload?: { key?: string; url?: string; path?: string } | null) {
		if (!upload?.key) return;
		upload.url = `${this.appUrl}/uploads/${upload.key}`;
		upload.path = `/uploads/${upload.key}`;
	}

	private async withViews(items: BlogEntity[]) {
		let counts = items.map(() => 0);
		try {
			const values = await this.redis.mget(items.map((item) => this.viewKey(item.id)));
			counts = values.map((value) => Number(value || 0));
		} catch {}
		return items.map((item, index) => ({ ...item, viewCount: counts[index] }));
	}
}
