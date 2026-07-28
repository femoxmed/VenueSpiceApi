import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VendorCategoryEntity } from './entities/vendor-category.entity';
import { VendorCategoriesController } from './vendor-categories.controller';
import { VendorCategoriesService } from './vendor-categories.service';

@Module({
	imports: [TypeOrmModule.forFeature([VendorCategoryEntity])],
	controllers: [VendorCategoriesController],
	providers: [VendorCategoriesService],
	exports: [VendorCategoriesService],
})
export class VendorCategoriesModule {}
