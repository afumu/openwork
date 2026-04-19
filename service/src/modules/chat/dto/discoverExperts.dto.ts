import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class DiscoverExpertsDto {
  @ApiProperty({ description: '讨论主题', example: '中东冲突对全球资本市场的影响' })
  @IsString()
  topic: string;

  @ApiProperty({ description: '最多返回多少位专家', required: false, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
