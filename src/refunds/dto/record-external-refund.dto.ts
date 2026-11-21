import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class RecordExternalRefundDto {
	@IsUUID()
	orderId: string;

	@IsIn(['full', 'partial'])
	refundType: 'full' | 'partial';

	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0.01)
	amount: number;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	stripeRefundId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	externalReference?: string;

	@IsOptional()
	@IsString()
	@MaxLength(50)
	method?: string;

	@IsString()
	@MinLength(5)
	@MaxLength(1000)
	reason: string;

	@IsOptional()
	@IsString()
	evidenceUrl?: string;
}
