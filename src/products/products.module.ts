import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
	imports: [TypeOrmModule.forFeature([ProductEntity]), UploadsModule],
	controllers: [ProductsController],
	providers: [ProductsService],
	exports: [ProductsService],
})
export class ProductsModule {}
