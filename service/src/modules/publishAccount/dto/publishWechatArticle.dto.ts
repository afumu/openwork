import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class PublishWechatArticleDto {
  @ApiProperty({ description: '对话分组 ID' })
  @IsNumber()
  groupId: number;

  @ApiProperty({ description: '产物路径' })
  @IsString()
  path: string;

  @ApiProperty({ description: '发布账号 ID', required: false })
  @IsOptional()
  @IsNumber()
  accountId?: number;

  @ApiProperty({ description: '运行目录 ID', required: false })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiProperty({ description: '发布标题', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: '摘要', required: false })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({ description: '主题 ID', required: false })
  @IsOptional()
  @IsString()
  themeId?: string;

  @ApiProperty({ description: '发布工作副本 Markdown', required: false })
  @IsOptional()
  @IsString()
  markdown?: string;

  @ApiProperty({ description: '封面图地址', required: false })
  @IsOptional()
  @IsString()
  coverUrl?: string;

  @ApiProperty({ description: '选中的本地封面相对路径', required: false })
  @IsOptional()
  @IsString()
  selectedCoverPath?: string;
}
