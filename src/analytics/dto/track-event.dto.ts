import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
export class TrackEventDto {
  @IsUUID() id: string;
  @IsUUID() visitorId: string;
  @IsUUID() sessionId: string;
  @IsIn(['page_view', 'engagement', 'ticket_selected', 'checkout_started']) name: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsString() @MaxLength(64) @IsIn(['home', 'events', 'event_detail', 'ticket_selection', 'checkout', 'other']) page: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) engagedSeconds?: number;
}
