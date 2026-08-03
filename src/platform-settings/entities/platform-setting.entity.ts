import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('platform_settings')
export class PlatformSettingEntity {
	@PrimaryColumn({ type: 'varchar', length: 120 })
	key: string;

	@Column({ type: 'text' })
	value: string;

	@Column({ name: 'value_type', type: 'varchar', default: 'string' })
	valueType: 'string' | 'number' | 'boolean';

	@Column({ type: 'text', nullable: true })
	description?: string | null;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy?: string | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
