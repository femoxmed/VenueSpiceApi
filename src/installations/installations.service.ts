import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstallationEntity } from '../installations/entities/installation.entity';

@Injectable()
export class InstallationsService {
  constructor(
    @InjectRepository(InstallationEntity)
    private readonly installationsRepository: Repository<InstallationEntity>,
  ) {}

  findAll() {
    return this.installationsRepository.find({ order: { createdAt: 'DESC' } });
  }

  findByCustomer(userId: string) {
    return this.installationsRepository.find({
      where: { customer: { id: userId } },
      order: { createdAt: 'DESC' },
    });
  }
}
