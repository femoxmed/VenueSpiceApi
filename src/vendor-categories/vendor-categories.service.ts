import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateVendorCategoryDto } from './dto/create-vendor-category.dto';
import { VendorCategoryEntity } from './entities/vendor-category.entity';

export const defaultVendorCategories: CreateVendorCategoryDto[] = [
	{ label: 'Catering', searchTerms: ['Catering', 'Food service'], iconKey: 'catering', sortOrder: 1 },
	{ label: 'Drinks', searchTerms: ['Drinks', 'Bar service', 'Beverage'], iconKey: 'drinks', sortOrder: 2 },
	{ label: 'Security', searchTerms: ['Security'], iconKey: 'security', sortOrder: 3 },
	{ label: 'DJ', searchTerms: ['DJ', 'Music'], iconKey: 'dj', sortOrder: 4 },
	{ label: 'Movers', searchTerms: ['Movers', 'Logistics', 'Equipment rental'], iconKey: 'movers', sortOrder: 5 },
	{ label: 'Decor', searchTerms: ['Decor', 'Decoration'], iconKey: 'decor', sortOrder: 6 },
	{ label: 'MC', searchTerms: ['MC', 'Master of ceremony', 'Entertainment'], iconKey: 'mc', sortOrder: 7 },
	{ label: 'Event Planning', searchTerms: ['Event planning', 'Planner'], iconKey: 'event-planning', sortOrder: 8 },
	{ label: 'Venue Management', searchTerms: ['Venue management', 'Venue'], iconKey: 'venue-management', sortOrder: 9 },
	{ label: 'Photography', searchTerms: ['Photography', 'Photo'], iconKey: 'photography', sortOrder: 10 },
	{ label: 'Videography', searchTerms: ['Videography', 'Video'], iconKey: 'videography', sortOrder: 11 },
	{ label: 'Lighting', searchTerms: ['Lighting', 'Stage lighting'], iconKey: 'lighting', sortOrder: 12 },
	{ label: 'Sound', searchTerms: ['Sound', 'Audio'], iconKey: 'sound', sortOrder: 13 },
	{ label: 'Stage Production', searchTerms: ['Stage production', 'Stage'], iconKey: 'stage-production', sortOrder: 14 },
	{ label: 'Makeup Artist', searchTerms: ['Makeup artist', 'Makeup'], iconKey: 'makeup-artist', sortOrder: 15 },
	{ label: 'Hair Stylist', searchTerms: ['Hair stylist', 'Hair'], iconKey: 'hair-stylist', sortOrder: 16 },
	{ label: 'Ushering', searchTerms: ['Ushering', 'Ushers'], iconKey: 'ushering', sortOrder: 17 },
	{ label: 'Cleaning', searchTerms: ['Cleaning'], iconKey: 'cleaning', sortOrder: 18 },
	{ label: 'Printing', searchTerms: ['Printing', 'Print'], iconKey: 'printing', sortOrder: 19 },
	{ label: 'Florist', searchTerms: ['Florist', 'Flowers'], iconKey: 'florist', sortOrder: 20 },
	{ label: 'Cake & Pastry', searchTerms: ['Cake', 'Pastry', 'Bakery'], iconKey: 'cake-pastry', sortOrder: 21 },
	{ label: 'Rental Furniture', searchTerms: ['Rental furniture', 'Furniture'], iconKey: 'rental-furniture', sortOrder: 22 },
	{ label: 'Live Band', searchTerms: ['Live band', 'Band'], iconKey: 'live-band', sortOrder: 23 },
	{ label: 'Dancers', searchTerms: ['Dancers', 'Dance'], iconKey: 'dancers', sortOrder: 24 },
];

@Injectable()
export class VendorCategoriesService {
	constructor(
		@InjectRepository(VendorCategoryEntity)
		private readonly categoriesRepository: Repository<VendorCategoryEntity>,
	) {}

	findPublic() {
		return this.categoriesRepository.find({
			where: { isActive: true },
			order: { sortOrder: 'ASC', label: 'ASC' },
		});
	}

	findAll() {
		return this.categoriesRepository.find({
			order: { sortOrder: 'ASC', label: 'ASC' },
		});
	}

	async create(dto: CreateVendorCategoryDto) {
		const slug = dto.slug?.trim() || this.slugify(dto.label);
		const existing = await this.categoriesRepository.findOne({ where: { slug } });
		if (existing) throw new BadRequestException('Vendor category already exists');

		return this.categoriesRepository.save(
			this.categoriesRepository.create({
				label: dto.label.trim(),
				slug,
				searchTerms: dto.searchTerms ?? [dto.label.trim()],
				iconKey: dto.iconKey?.trim() || null,
				sortOrder: dto.sortOrder ?? 0,
				isActive: dto.isActive ?? true,
			}),
		);
	}

	async update(id: string, dto: Partial<CreateVendorCategoryDto>) {
		const category = await this.categoriesRepository.findOne({ where: { id } });
		if (!category) throw new NotFoundException('Vendor category not found');

		if (dto.label !== undefined) category.label = dto.label.trim();
		if (dto.slug !== undefined) category.slug = dto.slug.trim() || this.slugify(category.label);
		if (dto.searchTerms !== undefined) category.searchTerms = dto.searchTerms;
		if (dto.iconKey !== undefined) category.iconKey = dto.iconKey.trim() || null;
		if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
		if (dto.isActive !== undefined) category.isActive = dto.isActive;

		return this.categoriesRepository.save(category);
	}

	async seedDefaults() {
		for (const [index, seed] of defaultVendorCategories.entries()) {
			const slug = seed.slug || this.slugify(seed.label);
			const existing = await this.categoriesRepository.findOne({ where: { slug } });
			const payload = {
				label: seed.label.trim(),
				slug,
				searchTerms: seed.searchTerms ?? [seed.label.trim()],
				iconKey: seed.iconKey?.trim() || null,
				sortOrder: seed.sortOrder ?? index + 1,
				isActive: seed.isActive ?? true,
			};

			await this.categoriesRepository.save(
				this.categoriesRepository.create({
					...(existing ?? {}),
					...payload,
				}),
			);
		}
	}

	private slugify(value: string) {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)+/g, '');
	}
}
