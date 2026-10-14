import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
@Entity('analytics_events')
@Index('analytics_events_event_received_idx', ['eventId', 'receivedAt'])
@Index('analytics_events_received_idx', ['receivedAt'])
@Index('analytics_events_session_name_idx', ['sessionId', 'name'])
export class AnalyticsEventEntity {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 32 }) name: string;
  @Column({ name: 'visitor_id', type: 'uuid' }) visitorId: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
  @Column({ name: 'event_id', type: 'uuid', nullable: true }) eventId: string | null;
  @Column({ type: 'varchar', length: 64 }) page: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) source: string | null;
  @Column({ name: 'engaged_seconds', type: 'int', default: 0 }) engagedSeconds: number;
  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' }) receivedAt: Date;
}
