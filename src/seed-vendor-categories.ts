import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { VendorCategoryEntity } from './vendor-categories/entities/vendor-category.entity';
import { defaultVendorCategories } from './vendor-categories/vendor-categories.service';

dotenv.config();

function isEnabled(value?: string | boolean | number | null) {
	return ['true', '1', 'yes', 'require', 'required'].includes(
		String(value ?? '').trim().toLowerCase(),
	);
}

function slugify(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)+/g, '');
}

async function seedVendorCategories() {
	const dataSource = new DataSource({
		type: 'postgres',
		host: process.env.DB_HOST || 'localhost',
		port: Number(process.env.DB_PORT || 5432),
		username: process.env.DB_USERNAME || 'postgres',
		password: process.env.DB_PASSWORD || 'postgres',
		database: process.env.DB_NAME || 'aquzera',
		ssl: isEnabled(process.env.DB_SSL || process.env.DATABASE_SSL || process.env.PGSSLMODE)
			? {
					rejectUnauthorized: isEnabled(process.env.DB_SSL_REJECT_UNAUTHORIZED),
				}
			: false,
		entities: [VendorCategoryEntity],
		synchronize: false,
		logging: false,
	});

	await dataSource.initialize();
	const categoriesRepository = dataSource.getRepository(VendorCategoryEntity);

	for (const [index, seed] of defaultVendorCategories.entries()) {
		const slug = seed.slug || slugify(seed.label);
		const existingByLabel = await categoriesRepository.findOne({
			where: { label: seed.label.trim() },
		});

		if (existingByLabel) {
			console.log(`Skipped existing vendor category: ${seed.label.trim()}`);
			continue;
		}

		const existing = await categoriesRepository.findOne({ where: { slug } });
		const payload = {
			label: seed.label.trim(),
			slug,
			searchTerms: seed.searchTerms ?? [seed.label.trim()],
			iconKey: seed.iconKey?.trim() || null,
			sortOrder: seed.sortOrder ?? index + 1,
			isActive: seed.isActive ?? true,
		};

		await categoriesRepository.save(
			categoriesRepository.create({
				...(existing ?? {}),
				...payload,
			}),
		);

		console.log(`${existing ? 'Updated' : 'Created'} vendor category: ${payload.label}`);
	}

	await dataSource.destroy();
	console.log('Vendor category seed completed.');
}

seedVendorCategories().catch((error) => {
	console.error('Vendor category seed failed:', error);
	process.exit(1);
});
