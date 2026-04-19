import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class PublishWechatPreviewDto {
  @ApiProperty({ description: '对话分组 ID' })
  @IsNumber()
  groupId: number;

  @ApiProperty({ description: '运行目录 ID', required: false })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiProperty({ description: '产物路径' })
  @IsString()
  path: string;

  @ApiProperty({ description: '公众号主题 ID', required: false })
  @IsOptional()
  @IsString()
  themeId?: string;

  @ApiProperty({ description: '发布工作副本 Markdown', required: false })
  @IsOptional()
  @IsString()
  markdown?: string;

  @ApiProperty({ description: '是否强制重新搜索封面', required: false })
  @IsOptional()
  @IsBoolean()
  refreshCover?: boolean;
}
