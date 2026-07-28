import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { CreateVendorCatalogueItemDto } from './dto/create-vendor-catalogue-item.dto';
import { VendorCatalogueItemEntity } from './entities/vendor-catalogue-item.entity';

type DashboardUser = { id: string; role?: Role };
type NormalizedVendorCatalogueDto = Omit<Partial<CreateVendorCatalogueItemDto>, 'price' | 'priceType' | 'minPrice' | 'maxPrice'> & {
	price: number;
	priceType: 'fixed' | 'range';
	minPrice?: number | null;
	maxPrice?: number | null;
};

@Injectable()
export class VendorCatalogueService {
	constructor(
		@InjectRepository(VendorCatalogueItemEntity)
		private readonly catalogueRepository: Repository<VendorCatalogueItemEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
	) {}

	async findMine(user: DashboardUser) {
		const organization = await this.findVendorOrganization(user);
		return this.catalogueRepository.find({
			where: { organizationId: organization.id, status: 'active' },
			order: { createdAt: 'DESC' },
		});
	}

	async findPublicByVendor(vendorIdOrSlug: string) {
		const organization = await this.organizationsRepository.findOne({
			where: this.isUuid(vendorIdOrSlug)
				? [{ id: vendorIdOrSlug, type: 'vendor', status: 'active' }, { slug: vendorIdOrSlug, type: 'vendor', status: 'active' }]
				: { slug: vendorIdOrSlug, type: 'vendor', status: 'active' },
		});
		if (!organization) throw new NotFoundException('Vendor not found');
		return this.catalogueRepository.find({
			where: { organizationId: organization.id, status: 'active' },
			order: { createdAt: 'DESC' },
		});
	}

	async create(dto: CreateVendorCatalogueItemDto, user: DashboardUser) {
		const organization = await this.findVendorOrganization(user);
		return this.catalogueRepository.save(
			this.catalogueRepository.create({
				...this.normalizePricing(dto),
				minimumOrderQuantity: dto.minimumOrderQuantity ?? 1,
				organization,
				organizationId: organization.id,
				status: 'active',
			}),
		);
	}

	async update(id: string, dto: Partial<CreateVendorCatalogueItemDto>, user: DashboardUser) {
		const item = await this.findOwnedItem(id, user);
		Object.assign(item, this.normalizePricing({
			...dto,
			price: dto.price ?? Number(item.price),
			priceType: dto.priceType ?? item.priceType,
			minPrice: dto.minPrice ?? (item.minPrice == null ? undefined : Number(item.minPrice)),
			maxPrice: dto.maxPrice ?? (item.maxPrice == null ? undefined : Number(item.maxPrice)),
		}));
		return this.catalogueRepository.save(item);
	}

	async archive(id: string, user: DashboardUser) {
		const item = await this.findOwnedItem(id, user);
		item.status = 'archived';
		return this.catalogueRepository.save(item);
	}

	private async findOwnedItem(id: string, user: DashboardUser) {
		const organization = await this.findVendorOrganization(user);
		const item = await this.catalogueRepository.findOne({
			where: { id, organizationId: organization.id },
		});
		if (!item) throw new NotFoundException('Catalogue item not found');
		return item;
	}

	private async findVendorOrganization(user: DashboardUser) {
		const organization = await this.organizationsRepository.findOne({
			where: { ownerUserId: user.id, type: 'vendor' },
			order: { createdAt: 'DESC' },
		});
		if (!organization) {
			throw new ForbiddenException('Vendor organization not found for this account');
		}
		return organization;
	}

	private isUuid(value: string) {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	}

	private normalizePricing(dto: Partial<CreateVendorCatalogueItemDto>): NormalizedVendorCatalogueDto {
		const priceType = dto.priceType === 'range' ? 'range' : 'fixed';
		if (priceType === 'range') {
			const minPrice = Number(dto.minPrice);
			const maxPrice = Number(dto.maxPrice);
			if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) {
				throw new BadRequestException('Price range requires minimum and maximum prices');
			}
			if (maxPrice < minPrice) {
				throw new BadRequestException('Maximum price must be greater than or equal to minimum price');
			}
			return {
				...dto,
				priceType,
				price: minPrice,
				minPrice,
				maxPrice,
			};
		}

		const price = Number(dto.price);
		if (!Number.isFinite(price)) {
			throw new BadRequestException('Price is required');
		}
		return {
			...dto,
			priceType,
			price,
			minPrice: null,
			maxPrice: null,
		};
	}
}
