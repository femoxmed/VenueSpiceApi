import { IsIn } from 'class-validator';

export class UpdateDiscountCouponStatusDto {
	@IsIn([
		'pending_influencer_signup',
		'pending_influencer_approval',
		'active',
		'declined',
		'paused',
		'expired',
		'archived',
	])
	status:
		| 'pending_influencer_signup'
		| 'pending_influencer_approval'
		| 'active'
		| 'declined'
		| 'paused'
		| 'expired'
		| 'archived';
}
