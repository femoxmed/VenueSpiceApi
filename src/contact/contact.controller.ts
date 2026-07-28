import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
	constructor(private readonly contactService: ContactService) {}

	@Post('messages')
	createMessage(@Body() dto: CreateContactMessageDto) {
		return this.contactService.createMessage(dto);
	}
}
