export interface CustomCommand {
  /**
   * Title of the custom command
   */
  title: string;

  /**
   * Content of the custom command without frontmatter
   */
  content: string;

  /**
   * Whether the custom command is enabled as a context menu item
   */
  showInContextMenu: boolean;

  /**
   * Whether the custom command is enabled as a slash menu item
   */
  showInSlashMenu: boolean;

  /**
   * Order for display in context menu and settings
   */
  order: number;

  /**
   * Model key to use for the custom command
   */
  modelKey: string;

  /**
   * Pi model ID to use for the custom command when the pi backend is active
   */
  piModelId?: string;

  /**
   * Timestamp of the last time the custom command was used
   */
  lastUsedMs: number;
}
