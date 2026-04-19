import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ReadArtifactDto {
  @ApiProperty({ example: 1, description: '当前对话 groupId' })
  @IsInt()
  @Min(1)
  groupId: number;

  @ApiProperty({
    example: '20260414_130540_topic-demo',
    description: '运行目录 ID，可选；当 path 已是对话工作区相对路径时可以不传',
    required: false,
  })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiProperty({
    example: 'data/20260414_130540_topic-demo/00_index.md',
    description: '对话工作区相对文件路径；如传 runId 也可只传运行目录下的相对路径',
  })
  @IsString()
  path: string;
}
