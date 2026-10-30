import { Equals, IsOptional, ValidateNested, IsIn, IsNumber, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { REFUND_REASONS, RefundReason } from '../refund-policy';
export class RefundAmountsDto {
 @IsNumber({maxDecimalPlaces:2}) @Min(0) tickets: number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) serviceFee: number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) processingFee: number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) tax: number;
}
export class AdminRefundDto {
 @IsIn(REFUND_REASONS) cancellationReason: RefundReason;
 @IsOptional() @ValidateNested() @Type(() => RefundAmountsDto) refundAmounts?: RefundAmountsDto;
 @IsUUID() orderId: string;
 @IsString() @MinLength(5) @MaxLength(1000) reason: string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0.01) expectedAmount: number;
 @Equals(true) confirmed: boolean;
}
