import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePublishAccountDto {
  @ApiProperty({ description: '账号名称' })
  @IsString()
  @MaxLength(120)
  accountName: string;

  @ApiProperty({ description: '微信公众号 AppId' })
  @IsString()
  wechatAppId: string;

  @ApiProperty({ description: '微信公众号 AppSecret' })
  @IsString()
  wechatAppSecret: string;

  @ApiProperty({ description: '是否设为默认账号', required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
