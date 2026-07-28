import {
	Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
	UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { BlogsService } from './blogs.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Blogs')
@Controller('blogs')
export class BlogsController {
	constructor(private readonly blogsService: BlogsService) {}

	@Get('public')
	publicList(@Query('page') page?: string, @Query('limit') limit?: string) {
		return this.blogsService.publicList(Number(page), Number(limit));
	}

	@Get('public/featured')
	featured(@Query('limit') limit?: string) {
		return this.blogsService.featured(Number(limit));
	}

	@Get('public/:slug')
	publicOne(@Param('slug') slug: string) {
		return this.blogsService.publicOne(slug);
	}

	@Post('public/:slug/view')
	recordView(@Param('slug') slug: string) {
		return this.blogsService.recordView(slug);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.WRITER)
	@Get()
	findAll() {
		return this.blogsService.findAll();
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.WRITER)
	@Post()
	@UseInterceptors(FileFieldsInterceptor([
		{ name: 'bannerImage', maxCount: 1 },
		{ name: 'thumbnailImage', maxCount: 1 },
	]))
	create(@Req() req: any, @Body() dto: CreateBlogDto, @UploadedFiles() files: any) {
		return this.blogsService.create(dto, req.user.id, files);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.WRITER)
	@Patch(':id')
	@UseInterceptors(FileFieldsInterceptor([
		{ name: 'bannerImage', maxCount: 1 },
		{ name: 'thumbnailImage', maxCount: 1 },
	]))
	update(@Param('id') id: string, @Req() req: any, @Body() dto: CreateBlogDto, @UploadedFiles() files: any) {
		return this.blogsService.update(id, dto, req.user, files);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.WRITER)
	@Delete(':id')
	remove(@Param('id') id: string, @Req() req: any) {
		return this.blogsService.remove(id, req.user);
	}
}
