import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { PlatformSettingEntity } from './entities/platform-setting.entity';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

export type FeePayer = 'buyer' | 'organizer';

export type PricingSettings = {
	venueSpiceFeePercent: number;
	venueSpiceFeeFixed: number;
	paymentProcessingFeePercent: number;
	paymentProcessingFeeFixed: number;
	defaultFeePayer: FeePayer;
	stripeAutomaticTaxEnabled: boolean;
	stripeTaxCode: string;
	stripeTaxBehavior: 'exclusive' | 'inclusive' | 'unspecified';
};

const settingMap = {
	venueSpiceFeePercent: 'VENUE_SPICE_FEE_PERCENT',
	venueSpiceFeeFixed: 'VENUE_SPICE_FEE_FIXED',
	paymentProcessingFeePercent: 'PAYMENT_PROCESSING_FEE_PERCENT',
	paymentProcessingFeeFixed: 'PAYMENT_PROCESSING_FEE_FIXED',
	defaultFeePayer: 'DEFAULT_FEE_PAYER',
	stripeAutomaticTaxEnabled: 'STRIPE_AUTOMATIC_TAX_ENABLED',
	stripeTaxCode: 'STRIPE_TAX_CODE',
	stripeTaxBehavior: 'STRIPE_TAX_BEHAVIOR',
} satisfies Record<keyof PricingSettings, string>;

const defaults = {
	venueSpiceFeePercent: 0.032,
	venueSpiceFeeFixed: 1.29,
	paymentProcessingFeePercent: 0.029,
	paymentProcessingFeeFixed: 0.3,
	defaultFeePayer: 'buyer',
	stripeAutomaticTaxEnabled: true,
	stripeTaxCode: '',
	stripeTaxBehavior: 'exclusive',
} satisfies PricingSettings;

const descriptions: Record<string, string> = {
	VENUE_SPICE_FEE_PERCENT: 'Venue Spice percentage service fee per paid ticket. Use decimal format, e.g. 0.032 for 3.2%.',
	VENUE_SPICE_FEE_FIXED: 'Venue Spice fixed service fee per paid ticket.',
	PAYMENT_PROCESSING_FEE_PERCENT: 'Estimated Stripe/payment processing percentage fee per order. Use decimal format, e.g. 0.029 for 2.9%.',
	PAYMENT_PROCESSING_FEE_FIXED: 'Estimated Stripe/payment processing fixed fee per order.',
	DEFAULT_FEE_PAYER: 'Default fee payer for new checkouts. buyer adds fees on top; organizer absorbs fees.',
	STRIPE_AUTOMATIC_TAX_ENABLED: 'Enable Stripe Automatic Tax for ticket checkout sessions.',
	STRIPE_TAX_CODE: 'Optional Stripe tax code applied to ticket products, e.g. txcd_*. Leave blank to use Stripe defaults.',
	STRIPE_TAX_BEHAVIOR: 'Stripe price tax behavior for checkout line items: exclusive, inclusive, or unspecified.',
};

@Injectable()
export class PlatformSettingsService implements OnModuleInit {
	private readonly logger = new Logger(PlatformSettingsService.name);

	constructor(
		private readonly configService: ConfigService,
		@InjectRepository(PlatformSettingEntity)
		private readonly settingsRepository: Repository<PlatformSettingEntity>,
		private readonly auditService: AuditService,
	) {}

	async onModuleInit() {
		await this.seedDefaults();
	}

	async seedDefaults() {
		for (const [property, key] of Object.entries(settingMap) as Array<[keyof PricingSettings, string]>) {
			const existing = await this.settingsRepository.findOne({ where: { key } });
			if (existing) continue;

			const fallback = defaults[property];
			const envValue = this.configService.get<string>(`DEFAULT_${key}`)
				?? this.configService.get<string>(key)
				?? String(fallback);

			await this.settingsRepository.save(
				this.settingsRepository.create({
					key,
					value: envValue,
					valueType: this.valueType(fallback),
					description: descriptions[key],
				}),
			);
		}
		this.logger.log('Platform pricing settings are ready');
	}

	async findAll() {
		await this.seedDefaults();
		const rows = await this.settingsRepository.find({ order: { key: 'ASC' } });
		return {
			data: rows,
			pricing: await this.getPricingSettings(),
		};
	}

	async getPricingSettings(): Promise<PricingSettings> {
		const rows = await this.settingsRepository.find();
		const byKey = new Map(rows.map((row) => [row.key, row.value]));
		return {
			venueSpiceFeePercent: this.numberValue(byKey.get(settingMap.venueSpiceFeePercent), defaults.venueSpiceFeePercent),
			venueSpiceFeeFixed: this.numberValue(byKey.get(settingMap.venueSpiceFeeFixed), defaults.venueSpiceFeeFixed),
			paymentProcessingFeePercent: this.numberValue(byKey.get(settingMap.paymentProcessingFeePercent), defaults.paymentProcessingFeePercent),
			paymentProcessingFeeFixed: this.numberValue(byKey.get(settingMap.paymentProcessingFeeFixed), defaults.paymentProcessingFeeFixed),
			defaultFeePayer: this.feePayerValue(byKey.get(settingMap.defaultFeePayer), defaults.defaultFeePayer),
			stripeAutomaticTaxEnabled: this.booleanValue(byKey.get(settingMap.stripeAutomaticTaxEnabled), defaults.stripeAutomaticTaxEnabled),
			stripeTaxCode: byKey.get(settingMap.stripeTaxCode) ?? defaults.stripeTaxCode,
			stripeTaxBehavior: this.taxBehaviorValue(byKey.get(settingMap.stripeTaxBehavior), defaults.stripeTaxBehavior),
		};
	}

	async updatePricingSettings(
		dto: UpdatePlatformSettingsDto,
		actor?: { id?: string; email?: string; role?: string },
	) {
		const before = await this.getPricingSettings();
		const updates = Object.entries(dto).filter(([, value]) => value !== undefined) as Array<[keyof PricingSettings, PricingSettings[keyof PricingSettings]]>;

		for (const [property, value] of updates) {
			const key = settingMap[property];
			await this.settingsRepository.save(
				this.settingsRepository.create({
					key,
					value: String(value),
					valueType: this.valueType(defaults[property]),
					description: descriptions[key],
					updatedBy: actor?.id ?? null,
				}),
			);
		}

		const after = await this.getPricingSettings();
		await this.auditService.log(
			'platform_settings.pricing_updated',
			actor,
			'platform_settings',
			'pricing',
			{ before, after },
		);

		return after;
	}

	private numberValue(value: string | undefined, fallback: number) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
	}

	private feePayerValue(value: string | undefined, fallback: FeePayer): FeePayer {
		return value === 'organizer' || value === 'buyer' ? value : fallback;
	}

	private booleanValue(value: string | undefined, fallback: boolean) {
		if (value === undefined) return fallback;
		return value === 'true' || value === '1';
	}

	private taxBehaviorValue(value: string | undefined, fallback: PricingSettings['stripeTaxBehavior']) {
		return value === 'exclusive' || value === 'inclusive' || value === 'unspecified'
			? value
			: fallback;
	}

	private valueType(value: PricingSettings[keyof PricingSettings]) {
		if (typeof value === 'number') return 'number';
		if (typeof value === 'boolean') return 'boolean';
		return 'string';
	}
}
