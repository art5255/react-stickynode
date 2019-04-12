/**
 * Copyright 2015, Yahoo! Inc.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
/* global window, document */

'use strict';

import React, {Component} from 'react';
import PropTypes from 'prop-types'

import {subscribe} from 'subscribe-ui-event';
import classNames from 'classnames';
import shallowCompare from 'react-addons-shallow-compare';

// constants
const STATUS_ORIGINAL = 0; // The default status, locating at the original position.
const STATUS_RELEASED = 1; // The released status, locating at somewhere on document but not default one.
const STATUS_FIXED = 2; // The sticky status, locating fixed to the top or the bottom of screen.

let TRANSFORM_PROP = 'transform';

// global variable for all instances
let doc;
let docBody;
let docEl;
let canEnableTransforms = true; // Use transform by default, so no Sticky on lower-end browser when no Modernizr
let M;
let scrollDelta = 0;
let win;
let winHeight = -1;

class Sticky extends Component {
    constructor (props, context) {
        super(props, context);
        this.handleResize = this.handleResize.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleScrollStart = this.handleScrollStart.bind(this);
        this.delta = 0;
        this.stickyTop = 0;
        this.stickyBottom = 0;
        this.frozen = false;
        this.skipNextScrollEvent = false;
        this.scrollTop = -1;

        this.bottomBoundaryTarget = null;
        this.topTarget = null;
        this.subscribers = null;

        this.state = {
            top: 0, // A top offset from viewport top where Sticky sticks to when scrolling up
            bottom: 0, // A bottom offset from viewport top where Sticky sticks to when scrolling down
            width: 0, // Sticky width
            height: 0, // Sticky height
            x: 0, // The original x of Sticky
            y: 0, // The original y of Sticky
            topBoundary: 0, // The top boundary on document
            bottomBoundary: Infinity, // The bottom boundary on document
            status: STATUS_ORIGINAL, // The Sticky status
            pos: 0, // Real y-axis offset for rendering position-fixed and position-relative
            activated: false // once browser info is available after mounted, it becomes true to avoid checksum error
        };
    }

    static getTargetHeight (target) {
        return target && target.offsetHeight || 0;
    }

    getTopPosition (top) {
        // TODO, topTarget is for current layout, may remove
        // a top argument can be provided to override reading from the props
        top = top || this.props.top || this.props.topTarget || 0;
        if (typeof top === 'string') {
            if (!this.topTarget) {
                this.topTarget = doc.querySelector(top);
            }
            top = this.getTargetHeight(this.topTarget);
        }
        return top;
    }

    getTargetBottom (target) {
        if (!target) {
            return -1;
        }
        const rect = target.getBoundingClientRect();
        return this.scrollTop + rect.bottom;
    }

    getBottomBoundary (bottomBoundary) {
        // a bottomBoundary can be provided to avoid reading from the props
        let boundary = bottomBoundary || this.props.bottomBoundary;

        // TODO, bottomBoundary was an object, depricate it later.
        if (typeof boundary === 'object') {
            boundary = boundary.value || boundary.target || 0;
        }

        if (typeof boundary === 'string') {
            if (!this.bottomBoundaryTarget) {
                this.bottomBoundaryTarget = doc.querySelector(boundary);
            }
            boundary = this.getTargetBottom(this.bottomBoundaryTarget);
        }
        return boundary && boundary > 0 ? boundary : Infinity;
    }

    reset () {
        this.setState({
            status: STATUS_ORIGINAL,
            pos: 0
        });
    }

    release (pos) {
        this.setState({
            status: STATUS_RELEASED,
            pos: pos - this.state.y
        });
    }

    fix (pos) {
        this.setState({
            status: STATUS_FIXED,
            pos: pos
        });
    }

    /**
     * Update the initial position, width, and height. It should update whenever children change.
     * @param {Object} options optional top and bottomBoundary new values
     */
    updateInitialDimension (options = {}) {

        const outerRect = this.outerElement.getBoundingClientRect();
        const innerRect = this.innerElement.getBoundingClientRect();

        const width = outerRect.width || outerRect.right - outerRect.left;
        const height = innerRect.height || innerRect.bottom - innerRect.top;
        const outerY = outerRect.top + this.scrollTop;

        return new Promise((resolve) => this.setState({
            top: this.getTopPosition(options.top),
            bottom: Math.min(this.state.top + height, winHeight),
            width: width,
            height: height,
            x: outerRect.left,
            y: outerY,
            bottomBoundary: this.getBottomBoundary(options.bottomBoundary),
            topBoundary: outerY
        }, resolve));
    }

    async updateWithDimensions (props = {}) {
        await this.updateInitialDimension(props);
        this.update();    
    }
    
    handleResize (e, ae) {
        if (this.props.shouldFreeze()) {
            return;
        }

        winHeight = ae.resize.height;
        this.updateWithDimensions();
    }

    handleScrollStart (e, ae) {
        this.frozen = this.props.shouldFreeze();

        if (this.frozen) {
            return;
        }

        if (this.scrollTop === ae.scroll.top) {
            // Scroll position hasn't changed,
            // do nothing
            this.skipNextScrollEvent = true;
        } else {
            this.scrollTop = ae.scroll.top;
            this.updateInitialDimension();
        }
    }

    handleScroll (e, ae) {
        // Scroll doesn't need to be handled
        if (this.skipNextScrollEvent) {
            this.skipNextScrollEvent = false;
            return;
        }

        scrollDelta = ae.scroll.delta;
        this.scrollTop = ae.scroll.top;
        this.update();
    }

    /**
     * Update Sticky position.
     */
    update () {
        const disabled = !this.props.enabled ||
            this.state.bottomBoundary - this.state.topBoundary <= this.state.height ||
            (this.state.width === 0 && this.state.height === 0);

        if (disabled) {
            if (this.state.status !== STATUS_ORIGINAL) {
                this.reset();
            }
            return;
        }

        const delta = scrollDelta;
        // "top" and "bottom" are the positions that this.state.top and this.state.bottom project
        // on document from viewport.
        const top = this.scrollTop + this.state.top;
        const bottom = this.scrollTop + this.state.bottom;

        // There are 2 principles to make sure Sticky won't get wrong so much:
        // 1. Reset Sticky to the original postion when "top" <= topBoundary
        // 2. Release Sticky to the bottom boundary when "bottom" >= bottomBoundary
        if (top <= this.state.topBoundary) { // #1
            this.reset();
        } else if (bottom >= this.state.bottomBoundary) { // #2
            this.stickyBottom = this.state.bottomBoundary;
            this.stickyTop = this.stickyBottom - this.state.height;
            this.release(this.stickyTop);
        } else {
            if (this.state.height > winHeight - this.state.top) {
                // In this case, Sticky is higher then viewport minus top offset
                switch (this.state.status) {
                    case STATUS_ORIGINAL:
                        this.release(this.state.y);
                        this.stickyTop = this.state.y;
                        this.stickyBottom = this.stickyTop + this.state.height;
                        // Commentting out "break" is on purpose, because there is a chance to transit to FIXED
                        // from ORIGINAL when calling window.scrollTo().
                        // break;
                    // eslint-disable-next-line no-fallthrough
                    case STATUS_RELEASED:
                        // If "top" and "bottom" are inbetween stickyTop and stickyBottom, then Sticky is in
                        // RELEASE status. Otherwise, it changes to FIXED status, and its bottom sticks to
                        // viewport bottom when scrolling down, or its top sticks to viewport top when scrolling up.
                        this.stickyBottom = this.stickyTop + this.state.height;
                        if (delta > 0 && bottom > this.stickyBottom) {
                            this.fix(this.state.bottom - this.state.height);
                        } else if (delta < 0 && top < this.stickyTop) {
                            this.fix(this.state.top);
                        }
                        break;
                    // eslint-disable-next-line no-case-declarations
                    case STATUS_FIXED:
                        let toRelease = true;
                        const pos = this.state.pos;
                        const height = this.state.height;
                        // In regular cases, when Sticky is in FIXED status,
                        // 1. it's top will stick to the screen top,
                        // 2. it's bottom will stick to the screen bottom,
                        // 3. if not the cases above, then it's height gets changed
                        if (delta > 0 && pos === this.state.top) { // case 1, and scrolling down
                            this.stickyTop = top - delta;
                            this.stickyBottom = this.stickyTop + height;
                        } else if (delta < 0 && pos === this.state.bottom - height) { // case 2, and scrolling up
                            this.stickyBottom = bottom - delta;
                            this.stickyTop = this.stickyBottom - height;
                        } else if (pos !== this.state.bottom - height && pos !== this.state.top) { // case 3
                            // This case only happens when Sticky's bottom sticks to the screen bottom and
                            // its height gets changed. Sticky should be in RELEASE status and update its
                            // sticky bottom by calculating how much height it changed.
                            const deltaHeight = (pos + height - this.state.bottom);
                            this.stickyBottom = bottom - delta + deltaHeight;
                            this.stickyTop = this.stickyBottom - height;
                        } else {
                            toRelease = false;
                        }

                        if (toRelease) {
                            this.release(this.stickyTop);
                        }
                        break;
                }
            } else {
                // In this case, Sticky is shorter then viewport minus top offset
                // and will always fix to the top offset of viewport
                this.fix(this.state.top);
            }
        }
        this.delta = delta;
    }

    componentWillReceiveProps (nextProps) {
        this.updateWithDimensions(nextProps);
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevState.status !== this.state.status && this.props.onStateChange) {
            this.props.onStateChange({status: this.state.status});
        }
        // if the props for enabling are toggled, then trigger the update or reset depending on the current props
        if (prevProps.enabled !== this.props.enabled) {
            if (this.props.enabled) {
                this.setState({activated: true}, () => {
                    this.updateWithDimensions();
                });
            } else {
                this.setState({activated: false}, () => {
                    this.reset();
                });
            }
        }
    }

    componentWillUnmount () {
        const subscribers = this.subscribers || [];
        for (let i = subscribers.length - 1; i >= 0; i--) {
            this.subscribers[i].unsubscribe();
        }
    }

    componentDidMount () {
        // Only initialize the globals if this is the first
        // time this component type has been mounted
        if (!win) {
            win = window;
            doc = document;
            docEl = doc.documentElement;
            docBody = doc.body;
            winHeight = win.innerHeight || docEl.clientHeight;
            M = window.Modernizr;
            // No Sticky on lower-end browser when no Modernizr
            if (M && M.prefixed) {
                canEnableTransforms = M.csstransforms3d;
                TRANSFORM_PROP = M.prefixed('transform');
            }
        }

        // when mount, the scrollTop is not necessary on the top
        this.scrollTop = docBody.scrollTop + docEl.scrollTop;

        if (this.props.enabled) {
            this.setState({activated: true});
            this.updateWithDimensions();
        }
        // bind the listeners regardless if initially enabled - allows the component to toggle sticky functionality
        this.subscribers = [
            subscribe('scrollStart', this.handleScrollStart.bind(this), {useRAF: true}),
            subscribe('scroll', this.handleScroll.bind(this), {useRAF: true, enableScrollInfo: true}),
            subscribe('resize', this.handleResize.bind(this), {enableResizeInfo: true})
        ];
    }

    translate (style, pos) {
        const enableTransforms = canEnableTransforms && this.props.enableTransforms;
        if (enableTransforms && this.state.activated) {
            style[TRANSFORM_PROP] = 'translate3d(0,' + Math.round(pos) + 'px,0)';
        } else {
            style.top = pos + 'px';
        }
    }

    shouldComponentUpdate (nextProps, nextState) {
        return !this.props.shouldFreeze() && shallowCompare(this, nextProps, nextState);
    }

    render () {
        // TODO, "overflow: auto" prevents collapse, need a good way to get children height
        const innerStyle = {
            position: this.state.status === STATUS_FIXED ? 'fixed' : 'relative',
            top: this.state.status === STATUS_FIXED ? '0px' : '',
            zIndex: this.props.innerZ
        };
        const outerStyle = {};

        // always use translate3d to enhance the performance
        this.translate(innerStyle, this.state.pos);
        if (this.state.status !== STATUS_ORIGINAL) {
            innerStyle.width = this.state.width + 'px';
            outerStyle.height = this.state.height + 'px';
        }

        const outerClasses = classNames('sticky-outer-wrapper', this.props.className, {
            [this.props.activeClass]: this.state.status === STATUS_FIXED,
            [this.props.releasedClass]: this.state.status === STATUS_RELEASED
        });

        const children = this.props.children;

        return (
            <div ref={(outer) => { this.outerElement = outer; }} className={outerClasses} style={outerStyle}>
                <div ref={(inner) => { this.innerElement = inner; }} className='sticky-inner-wrapper' style={innerStyle}>
                    {typeof children === 'function' ? children({ status: this.state.status }) : children}
                </div>
            </div>
        );
    }
}

Sticky.displayName = 'Sticky';

Sticky.defaultProps = {
    shouldFreeze: function () { return false; },
    enabled: true,
    top: 0,
    bottomBoundary: 0,
    enableTransforms: true,
    activeClass: 'active',
    releasedClass: 'released',
    onStateChange: null
};

/**
 * @param {Boolean} enabled A switch to enable or disable Sticky.
 * @param {String/Number} top A top offset px for Sticky. Could be a selector representing a node
 *        whose height should serve as the top offset.
 * @param {String/Number} bottomBoundary A bottom boundary px on document where Sticky will stop.
 *        Could be a selector representing a node whose bottom should serve as the bottom boudary.
 */
Sticky.propTypes = {
    enabled: PropTypes.bool,
    top: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number
    ]),
    bottomBoundary: PropTypes.oneOfType([
        PropTypes.object,  // TODO, may remove
        PropTypes.string,
        PropTypes.number
    ]),
    enableTransforms: PropTypes.bool,
    activeClass: PropTypes.string,
    releasedClass: PropTypes.string,
    onStateChange: PropTypes.func,
    shouldFreeze: PropTypes.func,
    innerZ: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number
    ])
};

Sticky.STATUS_ORIGINAL = STATUS_ORIGINAL;
Sticky.STATUS_RELEASED = STATUS_RELEASED;
Sticky.STATUS_FIXED = STATUS_FIXED;

module.exports = Sticky;
