import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Query,
	UseGuards,
	UseInterceptors,
	UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateProductDto } from './dto/create-product.dto';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
	constructor(private readonly productsService: ProductsService) {}

	@Get('public')
	findPublic() {
		return this.productsService.findPublic();
	}

	@Get('public/listing')
	findPublicListing(@Query('page') page?: string, @Query('limit') limit?: string) {
		return this.productsService.findPublicListing(Number(page), Number(limit));
	}

	@Get('public/featured/latest')
	findLatestPublicFeatured() {
		return this.productsService.findLatestPublicFeatured();
	}

	@Get('public/featured/latest-item')
	findLatestPublicFeaturedItem() {
		return this.productsService.findLatestPublicFeaturedItem();
	}

	@Get('public/:slug')
	findPublicOne(@Param('slug') slug: string) {
		return this.productsService.findPublicOne(slug);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@Get()
	findAll() {
		return this.productsService.findAll();
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Post()
	@UseInterceptors(
		FileFieldsInterceptor([
			{ name: 'bannerImage', maxCount: 1 },
			{ name: 'mainImage', maxCount: 1 },
			{ name: 'galleryImages', maxCount: 10 },
		]),
	)
	create(
		@Body() dto: CreateProductDto,
		@UploadedFiles()
		files: {
			bannerImage?: Express.Multer.File[];
			mainImage?: Express.Multer.File[];
			galleryImages?: Express.Multer.File[];
		},
	) {
		if (
			files &&
			(files.bannerImage || files.mainImage || files.galleryImages)
		) {
			return this.productsService.createWithImages(dto, files);
		}
		return this.productsService.create(dto);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Delete(':id/images/:imageField')
	deleteImage(
		@Param('id') id: string,
		@Param('imageField')
		imageField: 'bannerImage' | 'mainImage' | 'galleryImages',
		@Query('index') imageIndex?: string,
	) {
		return this.productsService.deleteProductImage(
			id,
			imageField,
			imageIndex !== undefined ? Number(imageIndex) : undefined,
		);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.productsService.findOne(id);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Delete(':id')
	delete(@Param('id') id: string) {
		return this.productsService.delete(id);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Patch(':id')
	@UseInterceptors(
		FileFieldsInterceptor([
			{ name: 'bannerImage', maxCount: 1 },
			{ name: 'mainImage', maxCount: 1 },
			{ name: 'galleryImages', maxCount: 10 },
		]),
	)
	update(
		@Param('id') id: string,
		@Body() dto: any,
		@UploadedFiles()
		files: {
			bannerImage?: Express.Multer.File[];
			mainImage?: Express.Multer.File[];
			galleryImages?: Express.Multer.File[];
		},
	) {
		if (
			files &&
			(files.bannerImage || files.mainImage || files.galleryImages)
		) {
			return this.productsService.updateWithImages(id, dto, files);
		}
		return this.productsService.update(id, dto);
	}
}
