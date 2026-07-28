import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';
import { Request } from 'express';

type AuditActor = {
	id?: string;
	email?: string;
	role?: string;
};

@Injectable()
export class AuditService {
	constructor(
		@InjectRepository(AuditLogEntity)
		private readonly auditLogRepository: Repository<AuditLogEntity>,
	) {}

	async log(
		action: string,
		user?: AuditActor,
		entityType?: string,
		entityId?: string,
		changes?: Record<string, unknown>,
		metadata?: Record<string, unknown>,
		request?: Request,
	) {
		const log = this.auditLogRepository.create({
			action,
			userId: user?.id,
			userEmail: user?.email,
			userRole: user?.role,
			entityType,
			entityId,
			changes,
			metadata,
			ipAddress: request?.ip || request?.connection?.remoteAddress,
			userAgent: request?.get('User-Agent'),
		});

		return this.auditLogRepository.save(log);
	}

	async findAll(page = 1, limit = 50) {
		const skip = (page - 1) * limit;

		const [logs, total] = await this.auditLogRepository.findAndCount({
			order: { createdAt: 'DESC' },
			skip,
			take: limit,
		});

		return {
			data: logs,
			total,
			page,
			limit,
			totalPages: Math.ceil(total / limit),
		};
	}

	async findByUserId(userId: string, page = 1, limit = 50) {
		const skip = (page - 1) * limit;

		const [logs, total] = await this.auditLogRepository.findAndCount({
			where: { userId },
			order: { createdAt: 'DESC' },
			skip,
			take: limit,
		});

		return {
			data: logs,
			total,
			page,
			limit,
			totalPages: Math.ceil(total / limit),
		};
	}

	async findByEntity(
		entityType: string,
		entityId: string,
		page = 1,
		limit = 50,
	) {
		const skip = (page - 1) * limit;

		const [logs, total] = await this.auditLogRepository.findAndCount({
			where: { entityType, entityId },
			order: { createdAt: 'DESC' },
			skip,
			take: limit,
		});

		return {
			data: logs,
			total,
			page,
			limit,
			totalPages: Math.ceil(total / limit),
		};
	}
}
