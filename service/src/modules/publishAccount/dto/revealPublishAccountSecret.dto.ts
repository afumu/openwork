import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class RevealPublishAccountSecretDto {
  @ApiProperty({ description: '账号 ID' })
  @IsNumber()
  id: number;
}
