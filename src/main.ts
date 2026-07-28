import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import * as express from 'express';
import { join } from 'path';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const configService = app.get(ConfigService);
	const apiPrefix = configService.get<string>('API_PREFIX', 'api');

	// Enable CORS properly
	app.enableCors({
		origin: true,
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization'],
	});

	// Increase body parser limits for large file uploads
	// app.use(bodyParser.json({ limit: '50mb' }));
	// app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

	// ✅ NUCLEAR FIX: Skip JSON parser completely for multipart requests
	// app.use((req: Request, res: Response, next: NextFunction) => {
	// 	if (req.headers['content-type']?.startsWith('multipart/form-data')) {
	// 		// Remove the body property so NO PARSER WILL RUN
	// 		delete req.body;
	// 	}
	// 	next();
	// });

	// Serve uploads statically - MUST BE BEFORE GLOBAL API PREFIX
	app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

	// Global validation
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			forbidNonWhitelisted: true,
			// skipUndefinedProperties: true,
			// skipMissingProperties: true,
			// validateCustomDecorators: true,
		}),
	);

	app.setGlobalPrefix(apiPrefix);

	// Swagger
	const swaggerConfig = new DocumentBuilder()
		.setTitle('EventBox API')
		.setDescription(
			'APIs for organizations, events, ticket orders, referrals, Stripe checkout, uploads, queues, and admin operations.',
		)
		.setVersion('2.0.0')
		.addBearerAuth()
		.build();

	const document = SwaggerModule.createDocument(app, swaggerConfig);
	SwaggerModule.setup('docs', app, document);

	// Bull Board
	const serverAdapter = new ExpressAdapter();
	serverAdapter.setBasePath(`/${apiPrefix}/queues`);

	const notificationsQueue = app.get(getQueueToken('notifications')) as Queue;

	createBullBoard({
		queues: [new BullMQAdapter(notificationsQueue)],
		serverAdapter,
	});

	app.use(`/${apiPrefix}/queues`, serverAdapter.getRouter());

	await app.listen(configService.get<number>('PORT', 4000));
}

bootstrap();
