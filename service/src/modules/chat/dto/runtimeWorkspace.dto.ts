import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';

export class RuntimeWorkspaceListDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;
}

export class RuntimeWorkspaceReadDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;

  @ApiProperty({ example: 'README.md', description: '工作区内的相对文件路径' })
  @IsNotEmpty({ message: '文件路径不能为空！' })
  path: string;

  @IsOptional()
  runId?: string;
}

export class RuntimeWorkspaceWriteDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;

  @ApiProperty({ example: 'src/App.tsx', description: '工作区内的相对文件路径' })
  @IsNotEmpty({ message: '文件路径不能为空！' })
  path: string;

  @ApiProperty({ example: 'export default function App() {}', description: 'UTF-8 文本内容' })
  content: string;

  @IsOptional()
  baseUpdatedAt?: string;
}

export class RuntimeWorkspaceCreateDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;

  @ApiProperty({ example: 'src/new-file.ts', description: '工作区内的相对路径' })
  @IsNotEmpty({ message: '文件路径不能为空！' })
  path: string;

  @IsOptional()
  content?: string;

  @IsOptional()
  @IsIn(['file', 'directory'])
  kind?: 'file' | 'directory';
}

export class RuntimeWorkspaceRenameDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;

  @ApiProperty({ example: 'src/old.ts', description: '原工作区相对路径' })
  @IsNotEmpty({ message: '原文件路径不能为空！' })
  fromPath: string;

  @ApiProperty({ example: 'src/new.ts', description: '新工作区相对路径' })
  @IsNotEmpty({ message: '新文件路径不能为空！' })
  toPath: string;
}

export class RuntimeWorkspaceDeleteDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;

  @ApiProperty({ example: 'src/old.ts', description: '工作区内的相对路径' })
  @IsNotEmpty({ message: '文件路径不能为空！' })
  path: string;
}

export class RuntimeWorkspaceSearchDto {
  @ApiProperty({ example: 128, description: '对话组 ID' })
  @IsNotEmpty({ message: '对话组ID不能为空！' })
  groupId: number;

  @ApiProperty({ example: 'function App', description: '搜索关键词' })
  @IsNotEmpty({ message: '搜索关键词不能为空！' })
  query: string;

  @IsOptional()
  include?: string[];

  @IsOptional()
  exclude?: string[];
}
