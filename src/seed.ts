import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DatabaseSeedService } from './database/seeds/database.seed.service';

async function seed() {
	console.log('🔄 Starting database seed...');

	const app = await NestFactory.createApplicationContext(AppModule);
	const seedService = app.get(DatabaseSeedService);

	await seedService.run();

	console.log('✅ Database seeded successfully');
	await app.close();
	process.exit(0);
}

seed().catch((err) => {
	console.error('❌ Seed failed:', err);
	process.exit(1);
});
