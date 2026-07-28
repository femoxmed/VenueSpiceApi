import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { QueueService } from './queue.service';

class CleanQueueDto {
  @IsOptional()
  @IsIn(['completed', 'failed', 'wait', 'active', 'paused', 'delayed'])
  type?: 'completed' | 'failed' | 'wait' | 'active' | 'paused' | 'delayed';

  @IsOptional()
  @IsInt()
  @Min(0)
  grace?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

@ApiTags('Queues')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('queues')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Get('overview')
  getOverview() {
    return this.queueService.getOverview();
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Get('jobs')
  getJobs(
    @Query('state') state?: 'latest' | 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'prioritized',
    @Query('start', new DefaultValuePipe(0), ParseIntPipe) start?: number,
    @Query('end', new DefaultValuePipe(20), ParseIntPipe) end?: number,
  ) {
    return this.queueService.getJobs(state ?? 'latest', start, end);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch('jobs/:jobId/retry')
  retryJob(@Param('jobId') jobId: string) {
    return this.queueService.retryJob(jobId);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('pause')
  pauseQueue() {
    return this.queueService.pauseQueue();
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('resume')
  resumeQueue() {
    return this.queueService.resumeQueue();
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('clean')
  cleanQueue(@Body() dto: CleanQueueDto) {
    return this.queueService.cleanQueue(dto.grace ?? 0, dto.limit ?? 100, dto.type ?? 'failed');
  }
}
