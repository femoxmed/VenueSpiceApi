import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ScanTicketDto {
	@IsUUID()
	eventId: string;

	@IsString()
	code: string;

	@IsOptional()
	@IsString()
	source?: 'camera' | 'manual';
}
