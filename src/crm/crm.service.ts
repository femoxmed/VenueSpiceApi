import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmRecordEntity } from '../crm/entities/crm-record.entity';

@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(CrmRecordEntity)
    private readonly crmRepository: Repository<CrmRecordEntity>,
  ) {}

  findAll() {
    return this.crmRepository.find({ order: { createdAt: 'DESC' } });
  }
}
