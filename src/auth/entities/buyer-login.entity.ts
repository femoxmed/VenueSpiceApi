import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('buyer_login_challenges')
export class BuyerLoginChallengeEntity {
 @PrimaryColumn() email: string;
 @Column({type:'uuid'}) challengeId: string;
 @Column() codeHash: string;
 @Column({type:'timestamptz'}) expiresAt: Date;
 @Column({type:'timestamptz'}) sentAt: Date;
 @Column({default:0}) attempts: number;
 @Column({type:'timestamptz',nullable:true}) consumedAt: Date | null;
}

@Entity('buyer_login_limits')
export class BuyerLoginLimitEntity {
 @PrimaryColumn() key: string;
 @Column({type:'timestamptz'}) windowAt: Date;
 @Column({default:0}) count: number;
}
