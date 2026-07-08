import type { ComponentProps, ComponentType, ReactElement } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import ChangelogSvg from '@site/static/img/changelog.svg';
import DocsSvg from '@site/static/img/docs.svg';
import PublishSvg from '@site/static/img/publish.svg';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: ComponentType<ComponentProps<'svg'>>;
  description: ReactElement;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Conventional Changelog',
    Svg: ChangelogSvg,
    description: <>Generate CHANGELOG.md from conventional commits with a configurable preset and CLI.</>,
  },
  {
    title: 'Monorepo Publishing',
    Svg: PublishSvg,
    description: <>Build, stage, and publish every package in a pnpm workspace to npm in dependency order.</>,
  },
  {
    title: 'Workspace-Centered Docs',
    Svg: DocsSvg,
    description: (
      <>Keep detailed package documentation in one Docusaurus site while leaving concise package READMEs locally.</>
    ),
  },
];

function Feature({ title, Svg, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactElement {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
