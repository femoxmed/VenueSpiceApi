import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import { ProductEntity } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UploadsService } from '../uploads/uploads.service';

@Injectable()
export class ProductsService {
	constructor(
		@InjectRepository(ProductEntity)
		private readonly productsRepository: Repository<ProductEntity>,
		private readonly uploadsService: UploadsService,
	) {}

	findAll() {
		return this.productsRepository.find({
			where: { status: Not('archived') },
			order: { createdAt: 'DESC' },
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
		});
	}

	async findPublic() {
		const products = await this.productsRepository.find({
			where: { status: 'active' },
			order: {
				featuredAt: { direction: 'DESC', nulls: 'LAST' },
				sortOrder: 'ASC',
				createdAt: 'DESC',
			},
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
		});
		return products.map((product) => this.withPublicSlug(product));
	}

	async findPublicListing(page = 1, limit = 6) {
		const currentPage = Math.max(1, Math.floor(Number(page) || 1));
		const pageSize = Math.min(50, Math.max(1, Math.floor(Number(limit) || 6)));
		const [products, total] = await this.productsRepository.findAndCount({
			where: { status: 'active' },
			order: {
				featuredAt: { direction: 'DESC', nulls: 'LAST' },
				sortOrder: 'ASC',
				createdAt: 'DESC',
			},
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
			skip: (currentPage - 1) * pageSize,
			take: pageSize,
		});
		const featuredProduct = this.withPublicSlug(
			products.find((product) => product.featuredAt) ||
				(await this.productsRepository.findOne({
					where: { status: 'active', featuredAt: Not(IsNull()) },
					order: {
						featuredAt: { direction: 'DESC', nulls: 'LAST' },
						sortOrder: 'ASC',
						createdAt: 'DESC',
					},
					relations: ['bannerImage', 'mainImage', 'galleryImages'],
				})) ||
				products[0] ||
				null,
		);

		return {
			featuredProduct,
			products: products.map((product) => this.withPublicSlug(product)),
			pagination: {
				page: currentPage,
				limit: pageSize,
				total,
				totalPages: Math.max(1, Math.ceil(total / pageSize)),
			},
		};
	}

	async findLatestPublicFeatured() {
		const product = await this.productsRepository.findOne({
			where: { status: 'active', featuredAt: Not(IsNull()) },
			order: { featuredAt: 'DESC', createdAt: 'DESC' },
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
		});
		return this.withPublicSlug(product);
	}

	async findLatestPublicFeaturedItem() {
		const product =
			(await this.productsRepository.findOne({
				where: { status: 'active', featuredAt: Not(IsNull()) },
				order: { featuredAt: 'DESC', createdAt: 'DESC' },
				relations: ['bannerImage', 'mainImage', 'galleryImages'],
			})) ||
			(await this.productsRepository.findOne({
				where: { status: 'active' },
				order: { sortOrder: 'ASC', createdAt: 'DESC' },
				relations: ['bannerImage', 'mainImage', 'galleryImages'],
			}));

		if (!product) {
			return null;
		}

		const mainImage =
			this.resolveUploadUrl(product.mainImage) ||
			this.resolveUploadUrl(product.bannerImage) ||
			this.resolveUploadUrl(product.galleryImages?.[0]) ||
			null;

		return {
			id: product.id,
			name: product.name,
			slug: product.slug || this.slugify(product.name),
			price: Number(product.price || 0),
			priceLabel:
				product.startingPriceLabel ||
				`Starting From ₦${Number(product.price || 0).toLocaleString()}`,
			mainImage,
			colors:
				product.colors?.map((color) => ({
					id: color.id,
					label: color.label,
					value: color.value,
					imageUrl:
						this.resolveUploadUrl(color.image) || color.imageUrl || null,
				})) || [],
			specifications: product.specifications || [],
		};
	}

	async findPublicOne(slug: string) {
		const where: FindOptionsWhere<ProductEntity>[] = [
			{ slug, status: 'active' },
		];

		if (this.isUuid(slug)) {
			where.push({ id: slug, status: 'active' });
		}

		let product = await this.productsRepository.findOne({
			where,
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
		});

		if (!product) {
			const products = await this.productsRepository.find({
				where: { status: 'active' },
				relations: ['bannerImage', 'mainImage', 'galleryImages'],
			});
			product =
				products.find(
					(activeProduct) =>
						activeProduct.name && this.slugify(activeProduct.name) === slug,
				) || null;
		}

		if (!product) {
			throw new BadRequestException('Product not found');
		}

		return this.withPublicSlug(product);
	}

	async create(dto: CreateProductDto) {
		const normalizedDto = this.normalizeProductDto(dto);
		const existing = await this.productsRepository.findOne({
			where: { sku: normalizedDto.sku },
		});

		if (existing) {
			throw new BadRequestException('A product with this SKU already exists');
		}

		await this.ensureUniqueSlug(normalizedDto.slug);

		return this.productsRepository.save(
			this.productsRepository.create(normalizedDto),
		);
	}

	async createWithImages(
		dto: CreateProductDto,
		files: {
			bannerImage?: Express.Multer.File[];
			mainImage?: Express.Multer.File[];
			galleryImages?: Express.Multer.File[];
		},
	) {
		const normalizedDto = this.normalizeProductDto(dto);
		const existing = await this.productsRepository.findOne({
			where: { sku: normalizedDto.sku },
		});

		if (existing) {
			throw new BadRequestException('A product with this SKU already exists');
		}

		await this.ensureUniqueSlug(normalizedDto.slug);

		const product = this.productsRepository.create(
			normalizedDto as Partial<ProductEntity>,
		) as ProductEntity;

		// Process uploaded files
		if (files.bannerImage?.[0]) {
			const upload = await this.uploadsService.processUpload(
				files.bannerImage[0],
			);
			product.bannerImage = upload;
		}

		if (files.mainImage?.[0]) {
			const upload = await this.uploadsService.processUpload(
				files.mainImage[0],
			);
			product.mainImage = upload;
		}

		if (files.galleryImages) {
			const galleryUploads = await Promise.all(
				files.galleryImages.map((file) =>
					this.uploadsService.processUpload(file),
				),
			);
			product.galleryImages = galleryUploads;
		}

		return this.productsRepository.save(product);
	}

	async findOne(id: string) {
		const product = await this.productsRepository.findOne({
			where: this.isUuid(id) ? [{ id }, { slug: id }] : { slug: id },
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
		});

		if (!product) {
			throw new BadRequestException('Product not found');
		}

		return product;
	}

	async delete(id: string) {
		const product = await this.productsRepository.findOne({
			where: this.isUuid(id) ? [{ id }, { slug: id }] : { slug: id },
			relations: [
				'bannerImage',
				'mainImage',
				'galleryImages',
				'orderItems',
				'installations',
			],
		});

		if (!product) {
			throw new BadRequestException('Product not found');
		}

		const hasHistory =
			(product.orderItems?.length || 0) > 0 ||
			(product.installations?.length || 0) > 0;

		if (hasHistory) {
			product.status = 'archived';
			product.featuredAt = null;
			await this.productsRepository.save(product);

			return { deleted: false, archived: true, id: product.id };
		}

		const uploadKeys = this.collectProductUploadKeys(product);
		await this.productsRepository.remove(product);
		for (const key of uploadKeys) {
			await this.uploadsService.deleteFile(key).catch(() => undefined);
		}

		return { deleted: true, archived: false, id: product.id };
	}

	async deleteProductImage(
		productId: string,
		imageField: 'bannerImage' | 'mainImage' | 'galleryImages',
		imageIndex?: number,
	): Promise<void> {
		const product = await this.productsRepository.findOne({
			where: { id: productId },
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
		});

		if (!product) {
			throw new BadRequestException('Product not found');
		}

		if (imageField === 'bannerImage' && product.bannerImage) {
			await this.uploadsService.deleteFile(product.bannerImage.key);
			product.bannerImage = null;
		} else if (imageField === 'mainImage' && product.mainImage) {
			await this.uploadsService.deleteFile(product.mainImage.key);
			product.mainImage = null;
		} else if (
			imageField === 'galleryImages' &&
			product.galleryImages &&
			typeof imageIndex === 'number'
		) {
			const image = product.galleryImages[imageIndex];
			if (image) {
				await this.uploadsService.deleteFile(image.key);
				product.galleryImages.splice(imageIndex, 1);
			}
		}

		await this.productsRepository.save(product);
	}

	async updateWithImages(
		id: string,
		dto: any,
		files: {
			bannerImage?: Express.Multer.File[];
			mainImage?: Express.Multer.File[];
			galleryImages?: Express.Multer.File[];
		},
	) {
		const normalizedDto = this.normalizeProductDto(dto);
		const product = await this.productsRepository.findOne({
			where: { id },
			relations: ['bannerImage', 'mainImage', 'galleryImages'],
		});

		if (!product) {
			throw new BadRequestException('Product not found');
		}

		// Collect all files to delete
		const filesToDelete: string[] = [];

		// Process deleted images first
		if (normalizedDto.deletedImages) {
			const deletedImages = normalizedDto.deletedImages;
			for (const image of deletedImages) {
				// 1. FIRST remove relation from product
				if (image.type === 'banner') {
					product.bannerImage = null;
				} else if (image.type === 'main') {
					product.mainImage = null;
				} else if (image.type === 'gallery') {
					await this.productsRepository
						.createQueryBuilder()
						.relation(ProductEntity, 'galleryImages')
						.of(product)
						.remove(image.id);

					product.galleryImages = (product.galleryImages || []).filter(
						(galleryImage) => galleryImage.id !== image.id,
					);
				}

				// Add to delete queue
				filesToDelete.push(image.key);
			}
		}

		if (normalizedDto.sku) {
			const existing = await this.productsRepository.findOne({
				where: { sku: normalizedDto.sku },
			});

			if (existing && existing.id !== id) {
				throw new BadRequestException('A product with this SKU already exists');
			}
		}
		await this.ensureUniqueSlug(normalizedDto.slug, id);

		// Update text fields
		this.assignProductFields(product, normalizedDto);

		// Process new uploaded files
		if (files.bannerImage?.[0]) {
			if (product.bannerImage) {
				filesToDelete.push(product.bannerImage.key);
			}
			const upload = await this.uploadsService.processUpload(
				files.bannerImage[0],
			);
			product.bannerImage = upload;
		}

		if (files.mainImage?.[0]) {
			if (product.mainImage) {
				filesToDelete.push(product.mainImage.key);
			}
			const upload = await this.uploadsService.processUpload(
				files.mainImage[0],
			);
			product.mainImage = upload;
		}

		if (files.galleryImages) {
			const galleryUploads = await Promise.all(
				files.galleryImages.map((file) =>
					this.uploadsService.processUpload(file),
				),
			);
			product.galleryImages = [
				...(product.galleryImages || []),
				...galleryUploads,
			];
		}

		// ✅ ONE SINGLE FINAL SAVE - ALWAYS RUNS!
		await this.productsRepository.save(product);

		// ✅ NOW DELETE ALL FILES AFTER SAVE
		for (const key of filesToDelete) {
			await this.uploadsService.deleteFile(key);
		}

		return product;
	}

	async update(id: string, dto: Partial<CreateProductDto>) {
		const normalizedDto = this.normalizeProductDto(dto);
		const product = await this.productsRepository.findOne({ where: { id } });

		if (!product) {
			throw new BadRequestException('Product not found');
		}

		if (normalizedDto.sku) {
			const existing = await this.productsRepository.findOne({
				where: { sku: normalizedDto.sku },
			});
			if (existing && existing.id !== id) {
				throw new BadRequestException('A product with this SKU already exists');
			}
		}
		await this.ensureUniqueSlug(normalizedDto.slug, id);
		this.assignProductFields(product, normalizedDto);
		// Note: Image fields are only modified through updateWithImages method
		// Do not modify images via plain update endpoint

		return this.productsRepository.save(product);
	}

	private normalizeProductDto(dto: any) {
		const normalized = { ...dto };

		[
			'colors',
			'features',
			'specifications',
			'boxItems',
			'addOns',
			'deletedImages',
		].forEach((field) => {
			if (typeof normalized[field] === 'string' && normalized[field]) {
				try {
					normalized[field] = JSON.parse(normalized[field]);
				} catch {
					throw new BadRequestException(`${field} must be valid JSON`);
				}
			}
		});

		if (normalized.price !== undefined) {
			normalized.price = Number(normalized.price);
		}

		if (normalized.stock !== undefined) {
			normalized.stock = Number(normalized.stock);
		}

		if (normalized.sortOrder !== undefined) {
			normalized.sortOrder = Number(normalized.sortOrder);
		}

		if (normalized.featuredAt !== undefined) {
			normalized.featuredAt = normalized.featuredAt
				? new Date(normalized.featuredAt)
				: null;
		}

		if (!normalized.slug && normalized.name) {
			normalized.slug = this.slugify(normalized.name);
		} else if (normalized.slug) {
			normalized.slug = this.slugify(normalized.slug);
		}

		this.normalizeDetailSections(normalized);

		return normalized;
	}

	private normalizeDetailSections(product: any) {
		if (product.colors !== undefined) {
			product.colors = this.normalizeArray(
				product.colors,
				'colors',
				(color, index) => ({
					id: this.requiredString(color.id, `colors[${index}].id`),
					label: this.requiredString(color.label, `colors[${index}].label`),
					value: this.requiredString(color.value, `colors[${index}].value`),
					image: this.optionalImage(color.image, `colors[${index}].image`),
					imageUrl: this.optionalString(color.imageUrl),
				}),
			);
		}

		if (product.features !== undefined) {
			product.features = this.normalizeArray(
				product.features,
				'features',
				(feature, index) => ({
					title: this.requiredString(feature.title, `features[${index}].title`),
					titleLine2: this.optionalString(feature.titleLine2),
					description: this.requiredString(
						feature.description,
						`features[${index}].description`,
					),
					image: this.optionalImage(feature.image, `features[${index}].image`),
					imageUrl: this.optionalImageUrl(
						feature.image,
						feature.imageUrl,
						`features[${index}]`,
					),
					imageAlt: this.optionalString(feature.imageAlt),
					imageClassName: this.optionalString(feature.imageClassName),
				}),
			);
		}

		if (product.specifications !== undefined) {
			product.specifications = this.normalizeArray(
				product.specifications,
				'specifications',
				(specification, index) => ({
					label: this.requiredString(
						specification.label,
						`specifications[${index}].label`,
					),
					value: this.requiredString(
						specification.value,
						`specifications[${index}].value`,
					),
				}),
			);
		}

		if (product.boxItems !== undefined) {
			product.boxItems = this.normalizeArray(
				product.boxItems,
				'boxItems',
				(item, index) => ({
					title: this.requiredString(item.title, `boxItems[${index}].title`),
					image: this.optionalImage(item.image, `boxItems[${index}].image`),
					imageUrl: this.optionalImageUrl(
						item.image,
						item.imageUrl,
						`boxItems[${index}]`,
					),
					description: this.optionalString(item.description),
					imageAlt: this.optionalString(item.imageAlt),
				}),
			);
		}

		if (product.addOns !== undefined) {
			product.addOns = this.normalizeArray(
				product.addOns,
				'addOns',
				(addOn, index) => ({
					productId: this.requiredString(
						addOn.productId,
						`addOns[${index}].productId`,
					),
					isCompulsory:
						addOn.isCompulsory === true || addOn.isCompulsory === 'true',
				}),
			);
		}
	}

	private normalizeArray<T extends Record<string, unknown>>(
		value: unknown,
		fieldName: string,
		mapItem: (item: any, index: number) => T,
	) {
		if (!Array.isArray(value)) {
			throw new BadRequestException(`${fieldName} must be an array`);
		}

		return value.map((item, index) => {
			if (!item || typeof item !== 'object' || Array.isArray(item)) {
				throw new BadRequestException(
					`${fieldName}[${index}] must be an object`,
				);
			}

			return this.removeUndefinedFields(mapItem(item, index));
		});
	}

	private requiredString(value: unknown, fieldName: string) {
		if (typeof value !== 'string' || !value.trim()) {
			throw new BadRequestException(`${fieldName} is required`);
		}

		return value.trim();
	}

	private optionalString(value: unknown) {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}

		if (typeof value !== 'string') {
			throw new BadRequestException('Optional detail fields must be strings');
		}

		return value.trim();
	}

	private optionalImage(value: unknown, fieldName: string) {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}

		if (typeof value !== 'object' || Array.isArray(value)) {
			throw new BadRequestException(`${fieldName} must be an upload object`);
		}

		const image = value as Record<string, unknown>;
		const id = this.requiredString(image.id, `${fieldName}.id`);
		const url = this.requiredString(image.url, `${fieldName}.url`);

		return this.removeUndefinedFields({
			id,
			key: this.optionalString(image.key),
			path: this.optionalString(image.path),
			url,
			originalName: this.optionalString(image.originalName),
			mimeType: this.optionalString(image.mimeType),
			size: typeof image.size === 'number' ? image.size : undefined,
			variants: image.variants ?? undefined,
			status: this.optionalString(image.status),
			errorMessage: this.optionalString(image.errorMessage),
			isPublic:
				typeof image.isPublic === 'boolean' ? image.isPublic : undefined,
			uploadedById: this.optionalString(image.uploadedById),
			createdAt: this.optionalString(image.createdAt),
			updatedAt: this.optionalString(image.updatedAt),
		});
	}

	private optionalImageUrl(
		image: unknown,
		imageUrl: unknown,
		fieldName: string,
	) {
		if (image && typeof image === 'object' && !Array.isArray(image)) {
			return this.optionalString((image as Record<string, unknown>).url);
		}

		const url = this.optionalString(imageUrl);
		if (!url) {
			throw new BadRequestException(`${fieldName}.image is required`);
		}

		return url;
	}

	private removeUndefinedFields<T extends Record<string, unknown>>(value: T) {
		return Object.fromEntries(
			Object.entries(value).filter(
				([, fieldValue]) => fieldValue !== undefined,
			),
		) as T;
	}

	private collectProductUploadKeys(product: ProductEntity) {
		const keys = new Set<string>();

		if (product.bannerImage?.key) keys.add(product.bannerImage.key);
		if (product.mainImage?.key) keys.add(product.mainImage.key);
		product.galleryImages?.forEach((image) => {
			if (image.key) keys.add(image.key);
		});

		this.collectNestedUploadKeys(product.colors, keys);
		this.collectNestedUploadKeys(product.features, keys);
		this.collectNestedUploadKeys(product.boxItems, keys);

		return [...keys];
	}

	private collectNestedUploadKeys(items: unknown, keys: Set<string>) {
		if (!Array.isArray(items)) return;

		items.forEach((item) => {
			if (!item || typeof item !== 'object') return;

			const image = (item as { image?: { key?: string } }).image;
			if (image?.key) keys.add(image.key);
		});
	}

	private async ensureUniqueSlug(slug?: string, productId?: string) {
		if (!slug) return;

		const existing = await this.productsRepository.findOne({
			where: { slug },
		});

		if (existing && existing.id !== productId) {
			throw new BadRequestException('A product with this slug already exists');
		}
	}

	private assignProductFields(product: ProductEntity, dto: any) {
		const fields = [
			'name',
			'slug',
			'sku',
			'price',
			'stock',
			'shortDescription',
			'description',
			'startingPriceLabel',
			'colors',
			'features',
			'specifications',
			'boxItems',
			'addOns',
			'status',
			'featuredAt',
			'sortOrder',
		] as const;

		fields.forEach((field) => {
			if (dto[field] !== undefined) {
				(product as any)[field] = dto[field];
			}
		});
	}

	private slugify(value: string) {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)+/g, '');
	}

	private withPublicSlug(product: ProductEntity | null) {
		if (product && !product.slug && product.name) {
			product.slug = this.slugify(product.name);
		}

		return product;
	}

	private resolveUploadUrl(upload?: { url?: string; key?: string } | null) {
		if (!upload) return '';
		if (upload.url) return upload.url;
		if (!upload.key) return '';

		const baseUrl = (process.env.APP_URL || 'http://localhost:4000').replace(
			/\/$/,
			'',
		);
		return `${baseUrl}/uploads/${upload.key}`;
	}

	private isUuid(value: string) {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value,
		);
	}
}
