import { IsEmail } from 'class-validator';

export class FindMyTicketDto {
	@IsEmail()
	email: string;
}
