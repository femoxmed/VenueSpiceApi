import { Equals, IsIn, IsNumber, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { REFUND_REASONS, RefundReason } from '../refund-policy';
export class AdminRefundDto {
 @IsIn(REFUND_REASONS) cancellationReason: RefundReason;
 @IsUUID() orderId: string;
 @IsString() @MinLength(5) @MaxLength(1000) reason: string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0.01) expectedAmount: number;
 @Equals(true) confirmed: boolean;
}
