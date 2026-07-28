import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlogEntity } from './entities/blog.entity';
import { BlogsController } from './blogs.controller';
import { BlogsService } from './blogs.service';
import { UploadsModule } from '../uploads/uploads.module';
import { ProductEntity } from '../products/entities/product.entity';

@Module({
	imports: [
		ConfigModule,
		TypeOrmModule.forFeature([BlogEntity, ProductEntity]),
		UploadsModule,
	],
	controllers: [BlogsController],
	providers: [BlogsService],
})
export class BlogsModule {}
