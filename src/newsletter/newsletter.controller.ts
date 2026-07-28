import { Body, Controller, Get, Query, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { NewsletterService } from './newsletter.service';

@ApiTags('Newsletter')
@Controller('newsletter')
export class NewsletterController {
	constructor(private readonly newsletterService: NewsletterService) {}

	@Post('subscribe')
	subscribe(@Body() dto: SubscribeNewsletterDto) {
		return this.newsletterService.subscribe(dto);
	}

	@Get('unsubscribe')
	unsubscribe(@Query('token') token: string) {
		return this.newsletterService.unsubscribe(token);
	}
}
