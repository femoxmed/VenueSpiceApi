import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceTypeEntity } from './entities/service-type.entity';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';

@Injectable()
export class ServiceTypesService {
	constructor(
		@InjectRepository(ServiceTypeEntity)
		private readonly serviceTypesRepository: Repository<ServiceTypeEntity>,
	) {}

	findAll() {
		return this.serviceTypesRepository.find({
			order: { createdAt: 'DESC' },
		});
	}

	findActive() {
		return this.serviceTypesRepository.find({
			where: { isActive: true },
			order: { name: 'ASC' },
		});
	}

	async create(dto: CreateServiceTypeDto) {
		const code = dto.code.trim().toUpperCase();

		const existing = await this.serviceTypesRepository.findOne({
			where: { code },
		});

		if (existing) {
			throw new BadRequestException(
				'A service type with this code already exists',
			);
		}

		return this.serviceTypesRepository.save(
			this.serviceTypesRepository.create({
				...dto,
				code,
				requiresTechnician: dto.requiresTechnician ?? true,
				estimatedDurationMinutes: dto.estimatedDurationMinutes ?? 60,
				isActive: dto.isActive ?? true,
			}),
		);
	}

	async findOne(id: string) {
		const serviceType = await this.serviceTypesRepository.findOne({
			where: { id },
		});

		if (!serviceType) {
			throw new BadRequestException('Service type not found');
		}

		return serviceType;
	}

	async update(id: string, dto: Partial<CreateServiceTypeDto>) {
		const serviceType = await this.serviceTypesRepository.findOne({
			where: { id },
		});

		if (!serviceType) {
			throw new BadRequestException('Service type not found');
		}

		if (dto.code) {
			const code = dto.code.trim().toUpperCase();
			const existing = await this.serviceTypesRepository.findOne({
				where: { code },
			});

			if (existing && existing.id !== id) {
				throw new BadRequestException(
					'A service type with this code already exists',
				);
			}

			serviceType.code = code;
		}

		if (dto.name) {
			serviceType.name = dto.name;
		}

		if (dto.description !== undefined) {
			serviceType.description = dto.description;
		}

		if (dto.requiresTechnician !== undefined) {
			serviceType.requiresTechnician = dto.requiresTechnician;
		}

		if (dto.estimatedDurationMinutes !== undefined) {
			serviceType.estimatedDurationMinutes = dto.estimatedDurationMinutes;
		}

		if (dto.isActive !== undefined) {
			serviceType.isActive = dto.isActive;
		}

		return this.serviceTypesRepository.save(serviceType);
	}
}
