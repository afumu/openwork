import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ListArtifactsDto {
  @ApiProperty({ example: 1, description: '当前对话 groupId' })
  @IsInt()
  @Min(1)
  groupId: number;
}
